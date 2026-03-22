# ──────────────────────────────────────────────────────────
# Backend Dockerfile — FastAPI + PostgreSQL
# Multi-stage build: dependencies cached separately
# ──────────────────────────────────────────────────────────

FROM python:3.11-slim AS base

# Prevent Python from writing .pyc and enable unbuffered logs
ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    LANG=C.UTF-8 \
    LC_ALL=C.UTF-8

WORKDIR /app

# ── Stage 1: Install dependencies ──────────────────────
FROM base AS deps

# System deps for building Python packages (bcrypt, cryptography, psycopg2, hdbscan)
RUN apt-get update && \
    apt-get install -y --no-install-recommends \
        gcc g++ libffi-dev libpq-dev \
        build-essential cmake \
        tesseract-ocr && \
    rm -rf /var/lib/apt/lists/*

# Generous timeout for large ML packages (torch ~2GB) + retry on flaky connections
ENV PIP_DEFAULT_TIMEOUT=600 \
    PIP_RETRIES=10

COPY requirements.txt .

# Install numpy + Cython globally first — hdbscan needs numpy headers at compile time
RUN pip install --no-cache-dir numpy cython

# Install ALL packages into /install (--ignore-installed forces numpy into /install too,
# so it gets copied to the production stage via COPY --from=deps /install /usr/local)
RUN pip install --no-cache-dir --prefix=/install --ignore-installed -r requirements.txt

# ── Stage 2: Production image ──────────────────────────
FROM base AS production

# Runtime dependencies
RUN apt-get update && \
    apt-get install -y --no-install-recommends libpq5 tesseract-ocr && \
    rm -rf /var/lib/apt/lists/*

# Copy installed packages from deps stage
COPY --from=deps /install /usr/local

# Create non-root user
RUN groupadd -r app && useradd -r -g app -d /app -s /sbin/nologin app

# Copy application code
COPY . .

# Data directory for file storage (vectorstore, etc.)
RUN mkdir -p /app/data && chown -R app:app /app

USER app

# Health check — hit dedicated /api/health endpoint (no auth required)
HEALTHCHECK --interval=30s --timeout=5s --start-period=60s --retries=5 \
    CMD python -c "import urllib.request; urllib.request.urlopen('http://localhost:8000/api/health')" || exit 1

EXPOSE 8000

# Uvicorn with production settings
CMD ["python", "-m", "uvicorn", "main:app", \
     "--host", "0.0.0.0", \
     "--port", "8000", \
     "--workers", "2", \
     "--proxy-headers", \
     "--forwarded-allow-ips", "*", \
     "--log-level", "info"]
