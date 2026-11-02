"""
Calculations as jobs: submit, watch real progress, cancel (docs/adr/0023).

A calculation used to be one blocking HTTP request. The browser showed a
progress bar estimated from elapsed time, nothing could be cancelled, and a
closed tab left the CPU busy until the run finished. Here a request is
validated, queued and answered at once with a job id; the caller polls for
progress (the real BFGS or MD step, from calculate.RunHooks) and can cancel.

One worker thread, deliberately. The Space is one shared CPU; torch already
uses both cores for a single forward pass, and two concurrent calculations
would also race on process-global state — torch's default dtype and the
scoped torch.load guard in safe_load.py. The queue is bounded and every
finished job expires, so memory stays flat no matter who calls.
"""

from __future__ import annotations

import queue
import secrets
import shutil
import threading
import time
from collections import deque
from dataclasses import dataclass, field
from typing import Callable

from contract import ContractError

TERMINAL = ("succeeded", "failed", "cancelled")


@dataclass
class Job:
    id: str
    client: str
    run: Callable[["Job"], dict]
    workdir: str | None = None
    status: str = "queued"
    progress: dict = field(default_factory=dict)
    result: dict | None = None
    error: dict | None = None
    created: float = field(default_factory=time.time)
    started: float | None = None
    finished: float | None = None
    cancel_requested: threading.Event = field(default_factory=threading.Event)
    done: threading.Event = field(default_factory=threading.Event)


class JobStore:
    def __init__(self, *, max_queued: int = 6, ttl_seconds: float = 900,
                 max_entries: int = 200, per_client_active: int = 1,
                 per_client_hourly: int = 30):
        self.max_queued = max_queued
        self.ttl = ttl_seconds
        self.max_entries = max_entries
        self.per_client_active = per_client_active
        self.per_client_hourly = per_client_hourly
        self._jobs: dict[str, Job] = {}
        self._order: deque[str] = deque()
        self._lock = threading.Lock()
        self._queue: queue.Queue[str] = queue.Queue()
        # Only visitors with an admitted submission in the last hour (D44): a
        # defaultdict made an entry for every caller, refused ones included,
        # and nothing ever removed one.
        self._submissions: dict[str, deque[float]] = {}
        self._worker = threading.Thread(target=self._work, name="mace-job-worker", daemon=True)
        self._worker.start()

    # ── admission ──────────────────────────────────────────────────────────

    def submit(self, client: str, run: Callable[[Job], dict], workdir: str | None = None) -> Job:
        """Queue a job, or refuse it (429) when the queue or the caller is over limit."""
        with self._lock:
            self._reap_locked()
            now = time.time()
            window = self._submissions.get(client, deque())
            while window and now - window[0] > 3600:
                window.popleft()
            active = sum(1 for j in self._jobs.values()
                         if j.client == client and j.status not in TERMINAL)
            if active >= self.per_client_active:
                raise ContractError(
                    "You already have a calculation queued or running. Wait for it to "
                    "finish, or cancel it, before starting another.",
                    code="rate_limited", status=429)
            if len(window) >= self.per_client_hourly:
                raise ContractError(
                    f"This deployment accepts at most {self.per_client_hourly} calculations "
                    "per hour from one visitor. Try again later, or run SimpleAtom locally.",
                    code="rate_limited", status=429)
            queued = sum(1 for j in self._jobs.values() if j.status == "queued")
            if queued >= self.max_queued:
                raise ContractError(
                    "The calculation queue is full. Nothing was queued; try again in a "
                    "minute, or run SimpleAtom locally for unqueued access.",
                    code="busy", status=429)
            job = Job(id=secrets.token_urlsafe(16), client=client, run=run, workdir=workdir)
            self._jobs[job.id] = job
            self._order.append(job.id)
            window.append(now)
            self._submissions[client] = window
        self._queue.put(job.id)
        return job

    # ── queries ────────────────────────────────────────────────────────────

    def get(self, job_id: str) -> Job | None:
        with self._lock:
            self._reap_locked()
            return self._jobs.get(job_id)

    def queue_position(self, job: Job) -> int | None:
        if job.status != "queued":
            return None
        with self._lock:
            ahead = [j for j in self._order
                     if j in self._jobs and self._jobs[j].status in ("queued", "running")]
        return ahead.index(job.id) if job.id in ahead else None

    def describe(self, job: Job) -> dict:
        """The public view of a job. Never includes the client key or paths."""
        view = {
            "jobId": job.id,
            "status": job.status,
            "progress": dict(job.progress),
            "queuePosition": self.queue_position(job),
            "createdAt": job.created,
            "startedAt": job.started,
            "finishedAt": job.finished,
        }
        if job.status == "succeeded":
            view["result"] = job.result
        if job.error is not None:
            view["error"] = job.error
        return view

    # ── cancellation ───────────────────────────────────────────────────────

    def cancel(self, job_id: str) -> Job | None:
        """Idempotent. A queued job is dropped; a running one stops at its next step."""
        with self._lock:
            job = self._jobs.get(job_id)
            if job is None or job.status in TERMINAL:
                return job
            job.cancel_requested.set()
            if job.status == "queued":
                self._finish_locked(job, "cancelled")
        return job

    # ── worker ─────────────────────────────────────────────────────────────

    def _work(self) -> None:
        while True:
            job_id = self._queue.get()
            with self._lock:
                job = self._jobs.get(job_id)
                if job is None or job.status != "queued":
                    continue
                job.status = "running"
                job.started = time.time()
            try:
                result = job.run(job)
                with self._lock:
                    if job.cancel_requested.is_set():
                        # D45: a cancel that arrived during a phase with no step
                        # hook (a single point) used to end "succeeded"; the
                        # caller asked for nothing, so nothing is reported.
                        self._finish_locked(job, "cancelled")
                    else:
                        job.result = result
                        self._finish_locked(job, "succeeded")
            except Exception as exc:  # noqa: BLE001 — a job must never kill the worker
                with self._lock:
                    if job.cancel_requested.is_set():
                        self._finish_locked(job, "cancelled")
                    else:
                        job.error = {
                            "code": getattr(exc, "code", "calculation_failed"),
                            "message": str(exc) or type(exc).__name__,
                            "field": getattr(exc, "field", None),
                            "status": getattr(exc, "status", 500),
                        }
                        self._finish_locked(job, "failed")

    def _finish_locked(self, job: Job, status: str) -> None:
        job.status = status
        job.finished = time.time()
        if job.workdir:
            shutil.rmtree(job.workdir, ignore_errors=True)
            job.workdir = None
        job.done.set()

    def _reap_locked(self) -> None:
        """Drop expired finished jobs, then the oldest finished ones over the cap."""
        now = time.time()
        for client in [c for c, w in self._submissions.items() if not w or now - w[-1] > 3600]:
            del self._submissions[client]
        for job_id in list(self._order):
            job = self._jobs.get(job_id)
            expired = job is not None and job.finished is not None and now - job.finished > self.ttl
            if job is None or expired:
                self._jobs.pop(job_id, None)
                self._order.remove(job_id)
        while len(self._jobs) > self.max_entries:
            oldest = next((j for j in self._order if self._jobs[j].status in TERMINAL), None)
            if oldest is None:
                break
            self._jobs.pop(oldest)
            self._order.remove(oldest)
