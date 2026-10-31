# SimpleAtom backend — the public Hugging Face Space (docs/adr/0002, 0025).
FROM python:3.11-slim

# build-essential stays: a few transitive dependencies may only publish sdists.
RUN apt-get update && \
    apt-get install -y --no-install-recommends build-essential && \
    rm -rf /var/lib/apt/lists/*

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    OMP_NUM_THREADS=2 \
    SIMPLEATOM_PROFILE=hosted

RUN useradd -m -u 1000 user
WORKDIR /app

# Hash-pinned, CPU-only lock (torch from the PyTorch CPU index). --no-deps: the
# lock is the complete closure, so pip cannot resolve anything it does not list.
COPY requirements.lock.txt .
RUN pip install --upgrade pip && \
    pip install --require-hashes --no-deps -r requirements.lock.txt

COPY --chown=user:user . .
USER user

# Bake the pinned MIT checkpoints into the image; fails the build on a hash
# mismatch. ASL checkpoints are fetched at runtime, never redistributed.
RUN python prefetch_checkpoints.py

EXPOSE 7860

HEALTHCHECK --interval=60s --timeout=10s --start-period=120s \
  CMD python -c "import urllib.request,sys; sys.exit(0 if urllib.request.urlopen('http://127.0.0.1:7860/health', timeout=5).status == 200 else 1)"

# One worker: calculations are serialised in-process (main.py), and torch's
# default dtype is process-global.
CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "7860", "--workers", "1"]
