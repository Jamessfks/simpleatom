# SimpleAtom backend — the public Hugging Face Space (docs/adr/0002, 0025).
# The base is pinned by digest (D83): a floating tag changed pip, Debian and
# Python patch level between two builds of one commit. Bump it deliberately.
FROM python:3.11-slim@sha256:673719e071ecf27434fd2635bbd8d00f49f4fdd81f243143438a42ced8bedf60

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1 \
    OMP_NUM_THREADS=2 \
    SIMPLEATOM_PROFILE=hosted

RUN useradd -m -u 1000 user
WORKDIR /app

# Hash-pinned, CPU-only lock (torch from the PyTorch CPU index). --no-deps: the
# lock is the complete closure, so pip cannot resolve anything it does not list.
# Every distribution installs from a wheel (--only-binary=:all:), so no compiler
# is in the image and a new sdist fails this build instead of compiling
# unnoticed. The two exceptions are pure-Python sdists with a plain setup.py;
# they build with the hash-pinned setuptools from build-requirements.lock.txt,
# not one fetched unhashed under build isolation. The base image's pip is used
# as is: an upgrade here would be one more unpinned download.
COPY requirements.lock.txt build-requirements.lock.txt ./
RUN pip install --require-hashes --no-deps -r build-requirements.lock.txt && \
    pip install --require-hashes --no-deps --no-build-isolation \
      --only-binary=:all: --no-binary=bibtexparser,python-hostlist \
      -r requirements.lock.txt

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
