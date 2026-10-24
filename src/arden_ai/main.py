from fastapi import FastAPI

from arden_ai.application import GenerationIndexer, PermissionAwareAnswerer
from arden_ai.infrastructure import (
    ChromaCandidateGenerationStore,
    ChromaPermissionAwareRetriever,
    OpenAIGroundedAnswerGenerator,
    Settings,
    get_settings,
)
from arden_ai.presentation import create_api


def create_app(
    *,
    settings: Settings | None = None,
    indexer: GenerationIndexer | None = None,
    answerer: PermissionAwareAnswerer | None = None,
) -> FastAPI:
    """Compose infrastructure with the HTTP presentation layer."""
    service_settings = settings or get_settings()
    return create_api(
        service_token=service_settings.service_token,
        indexer=indexer,
        indexer_factory=lambda: GenerationIndexer(
            ChromaCandidateGenerationStore(service_settings)
        ),
        answerer=answerer,
        answerer_factory=lambda: PermissionAwareAnswerer(
            ChromaPermissionAwareRetriever(service_settings),
            OpenAIGroundedAnswerGenerator(service_settings),
        ),
    )


app = create_app()

