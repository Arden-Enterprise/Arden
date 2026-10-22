from fastapi import FastAPI

from arden_ai import __version__

app = FastAPI(
    title="Arden AI",
    summary="Internal permission-aware retrieval and generation service",
    version=__version__,
)


@app.get("/health/live", tags=["health"])
async def live() -> dict[str, str]:
    return {"status": "ok"}


@app.get("/health/ready", tags=["health"])
async def ready() -> dict[str, str]:
    # Dependency probes will be added when Chroma/OpenAI-backed routes are introduced.
    return {"status": "ready", "version": __version__}

