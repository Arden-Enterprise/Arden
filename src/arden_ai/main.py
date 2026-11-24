from fastapi import FastAPI

from arden_ai.application import GenerationIndexer, PermissionAwareAnswerer
from arden_ai.application.governed import GovernedAnswerer
from arden_ai.application.reader_summary import ReaderSummarizer
from arden_ai.application.writing import Writer
from arden_ai.infrastructure import (
    ChromaCandidateGenerationStore,
    ChromaPermissionAwareRetriever,
    OpenAIGroundedAnswerGenerator,
    Settings,
    get_settings,
)
from arden_ai.infrastructure.hybrid import HybridRetriever
from arden_ai.infrastructure.reader_summary import OpenAISummaryGenerator
from arden_ai.infrastructure.writing import OpenAIWritingProvider
from arden_ai.presentation import create_api


def create_app(
    *,
    settings: Settings | None = None,
    indexer: GenerationIndexer | None = None,
    answerer: PermissionAwareAnswerer | None = None,
    governed: GovernedAnswerer | None = None,
    summaries: ReaderSummarizer | None = None,
    writer: Writer | None = None,
) -> FastAPI:
    """Compose infrastructure with the HTTP presentation layer."""
    service_settings = settings or get_settings()
    return create_api(
        service_token=service_settings.service_token,
        indexer=indexer,
        indexer_factory=lambda: GenerationIndexer(ChromaCandidateGenerationStore(service_settings)),
        answerer=answerer,
        governed=governed,
        summaries=summaries,
        writer=writer,
        writer_factory=lambda: Writer(OpenAIWritingProvider(service_settings)),
        summaries_factory=lambda: ReaderSummarizer(OpenAISummaryGenerator(service_settings)),
        governed_factory=lambda: GovernedAnswerer(
            HybridRetriever(ChromaPermissionAwareRetriever(service_settings)),
            OpenAIGroundedAnswerGenerator(service_settings),
        ),
        answerer_factory=lambda: PermissionAwareAnswerer(
            ChromaPermissionAwareRetriever(service_settings),
            OpenAIGroundedAnswerGenerator(service_settings),
        ),
    )


app = create_app()
