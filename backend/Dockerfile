# ──────────────────────────────────────────────────────────
# Backend Dockerfile — FastAPI + PostgreSQL
# Multi-stage build: dependencies cached separately
# ──────────────────────────────────────────────────────────

FROM python:3.11-slim AS base

# Prevent Python from writing .pyc and enable unbuffered logs
ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    # Ensure UTF-8 for Chinese/emoji console output
    LANG=C.UTF-8 \
    LC_ALL=C.UTF-8

WORKDIR /app

# ── Stage 1: Install dependencies ──────────────────────
FROM base AS deps

# System deps for building Python packages (bcrypt, cryptography, psycopg2)
RUN apt-get update && \
    apt-get install -y --no-install-recommends gcc libffi-dev libpq-dev && \
    rm -rf /var/lib/apt/lists/*

COPY requirements.txt .
RUN pip install --no-cache-dir --prefix=/install -r requirements.txt

# ── Stage 2: Production image ──────────────────────────
FROM base AS production

# Runtime dependency for psycopg2
RUN apt-get update && \
    apt-get install -y --no-install-recommends libpq5 && \
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

# Health check — hit FastAPI docs endpoint
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
    CMD python -c "import urllib.request; urllib.request.urlopen('http://localhost:8000/docs')" || exit 1

EXPOSE 8000

# Uvicorn with production settings
CMD ["python", "-m", "uvicorn", "main:app", \
     "--host", "0.0.0.0", \
     "--port", "8000", \
     "--workers", "4", \
     "--proxy-headers", \
     "--forwarded-allow-ips", "*", \
     "--log-level", "info"]
