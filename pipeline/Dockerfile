# syntax=docker/dockerfile:1.7

# Build with:  docker build -t heal-atlas-pipeline pipeline/
# Multi-arch:  docker buildx build --platform linux/amd64,linux/arm64 -t heal-atlas-pipeline pipeline/
#
# Two-stage build keeps the runtime image small: builder has uv + build tools,
# runtime has only the resolved venv and the package.

# ---------- builder ----------
FROM ghcr.io/astral-sh/uv:python3.12-bookworm-slim AS builder

ENV UV_COMPILE_BYTECODE=1 \
    UV_LINK_MODE=copy \
    UV_PROJECT_ENVIRONMENT=/app/.venv

WORKDIR /app

# Resolve and install dependencies first so source edits don't bust the cache.
# uv.lock is optional on first build; commit it after `uv lock` for reproducible builds.
COPY pyproject.toml ./
COPY uv.lock* ./
RUN --mount=type=cache,target=/root/.cache/uv \
    uv sync --no-install-project --no-dev

# Now install the package itself into the same venv.
COPY heal_atlas ./heal_atlas
RUN --mount=type=cache,target=/root/.cache/uv \
    uv sync --no-dev

# ---------- runtime ----------
FROM python:3.12-slim-bookworm AS runtime

WORKDIR /app
COPY --from=builder /app /app

ENV PATH="/app/.venv/bin:$PATH"

# CLI takes <input.json> <output.json>; mount a host dir at /data and pass /data/...
ENTRYPOINT ["heal-atlas"]
