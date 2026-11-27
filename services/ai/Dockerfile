FROM ghcr.io/astral-sh/uv:0.9.27-python3.11-bookworm-slim@sha256:6e289b41fb0de001f5fe78b05568516e1a1caf95f5f4ac6b64c01d781a5dacdf AS build

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    UV_COMPILE_BYTECODE=1 \
    UV_LINK_MODE=copy \
    UV_NO_CACHE=1 \
    UV_PYTHON_PREFERENCE=only-system \
    UV_PYTHON=/usr/local/bin/python3.11 \
    TIKTOKEN_CACHE_DIR=/app/.tiktoken-cache

WORKDIR /app

COPY pyproject.toml uv.lock README.md ./
COPY src ./src

RUN uv sync --frozen --no-dev --no-editable \
    && mkdir -p /app/.tiktoken-cache \
    && /app/.venv/bin/python -c "import tiktoken; tiktoken.get_encoding('cl100k_base'); tiktoken.get_encoding('o200k_base')"

FROM python:3.11-slim-bookworm@sha256:ef56ae98435cc40d8a27020b0b32a9941515acd5840f0fba34858bb34dd362d1 AS ai

ARG REVISION=""
ARG AI_TREE=""

LABEL org.opencontainers.image.revision=$REVISION \
      io.arden.release.ai_tree=$AI_TREE \
      io.arden.release.ai_managed="1"

# Patch current OS security fixes without adding curl, uv, or build toolchains to runtime.
RUN apt-get update \
    && apt-get upgrade --yes --no-install-recommends \
    && rm -rf /var/lib/apt/lists/* \
    && mkdir -p /app \
    && chown 1000:1000 /app

WORKDIR /app

COPY --from=build --chown=1000:1000 /app/.venv /app/.venv
COPY --from=build --chown=1000:1000 /app/.tiktoken-cache /app/.tiktoken-cache

USER 1000:1000

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    HOME=/tmp \
    ANONYMIZED_TELEMETRY=FALSE \
    TIKTOKEN_CACHE_DIR=/app/.tiktoken-cache \
    PATH="/app/.venv/bin:/usr/local/bin:/usr/bin:/bin"

EXPOSE 8080

HEALTHCHECK --interval=10s --timeout=5s --start-period=30s --retries=6 \
    CMD ["/app/.venv/bin/python", "-c", "import urllib.request; urllib.request.urlopen('http://127.0.0.1:8080/health/live', timeout=3)"]

CMD ["/app/.venv/bin/uvicorn", "arden_ai.main:app", "--host", "0.0.0.0", "--port", "8080", "--no-access-log"]
