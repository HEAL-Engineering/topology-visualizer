# syntax=docker/dockerfile:1.7

# Multi-stage build mirroring pipeline/Dockerfile.
# Build with:    docker build -t heal-daily-pages .
# Multi-arch:    docker buildx build --platform linux/amd64,linux/arm64 -t heal-daily-pages .

# ---------- builder ----------
FROM ghcr.io/astral-sh/uv:python3.12-bookworm-slim AS builder

ENV UV_COMPILE_BYTECODE=1 \
    UV_LINK_MODE=copy \
    UV_PROJECT_ENVIRONMENT=/app/.venv

WORKDIR /app

# Resolve and install deps first (cache-friendly).
COPY pyproject.toml ./
COPY uv.lock* ./
RUN --mount=type=cache,target=/root/.cache/uv \
    uv sync --no-install-project --no-dev

# Now install the package itself.
COPY src ./src
RUN --mount=type=cache,target=/root/.cache/uv \
    uv sync --no-dev

# ---------- runtime ----------
FROM python:3.12-slim-bookworm AS runtime

WORKDIR /app
COPY --from=builder /app /app
COPY alembic ./alembic
COPY alembic.ini ./alembic.ini

ENV PATH="/app/.venv/bin:$PATH"

CMD ["heal-pages"]
