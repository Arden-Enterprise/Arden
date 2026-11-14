import asyncio
import hmac
import json
import logging
import time
from collections.abc import Callable
from typing import Annotated

from fastapi import Depends, FastAPI, Header, HTTPException, status
from pydantic import SecretStr

from arden_ai import __version__
from arden_ai.application import GenerationIndexer, PermissionAwareAnswerer
from arden_ai.application.governed import GovernedAnswerer
from arden_ai.application.reader_question import UnsupportedReaderQuestion
from arden_ai.application.reader_sources import prepare_reader_source
from arden_ai.application.reader_summary import ReaderSummarizer, UnsupportedSummary
from arden_ai.contracts import (
    AnswerRequest,
    AnswerResponse,
    IndexGenerationManifest,
    IndexGenerationRequest,
)
from arden_ai.contracts.governed import (
    GenerationRequest,
    GenerationResponse,
    RetrievalRequest,
    RetrievalResponse,
)
from arden_ai.contracts.reader import ReaderSourceRequest, ReaderSourceResponse
from arden_ai.contracts.reader_summary import ReaderSummaryResponse
from arden_ai.presentation.summary_failures import summary_failure

logger = logging.getLogger(__name__)


def create_api(
    *,
    service_token: SecretStr | None,
    indexer: GenerationIndexer | None = None,
    indexer_factory: Callable[[], GenerationIndexer] | None = None,
    answerer: PermissionAwareAnswerer | None = None,
    answerer_factory: Callable[[], PermissionAwareAnswerer] | None = None,
    governed: GovernedAnswerer | None = None,
    governed_factory: Callable[[], GovernedAnswerer] | None = None,
    summaries: ReaderSummarizer | None = None,
    summaries_factory: Callable[[], ReaderSummarizer] | None = None,
) -> FastAPI:
    application = FastAPI(
        title="Arden AI",
        summary="Internal permission-aware retrieval and generation service",
        version=__version__,
    )
    application.state.generation_indexer = indexer
    application.state.permission_aware_answerer = answerer
    application.state.governed_answerer = governed
    application.state.reader_summarizer = summaries

    def runtime_summaries() -> ReaderSummarizer:
        current: ReaderSummarizer | None = application.state.reader_summarizer
        if current is None:
            if summaries_factory is None:
                raise HTTPException(status_code=503, detail="Summary is unavailable")
            try:
                current = summaries_factory()
            except ValueError as error:
                raise HTTPException(status_code=503, detail="Summary is unavailable") from error
            application.state.reader_summarizer = current
        return current

    def authorize_service(
        authorization: Annotated[str | None, Header()] = None,
    ) -> None:
        if service_token is None:
            raise HTTPException(status_code=503, detail="Service authentication is not configured")
        scheme, separator, credential = (authorization or "").partition(" ")
        if not (
            separator
            and scheme.lower() == "bearer"
            and hmac.compare_digest(credential, service_token.get_secret_value())
        ):
            raise HTTPException(
                status_code=401,
                detail="Invalid service credentials",
                headers={"WWW-Authenticate": "Bearer"},
            )

    def runtime_governed() -> GovernedAnswerer:
        current: GovernedAnswerer | None = application.state.governed_answerer
        if current is None:
            if governed_factory is None:
                raise HTTPException(status_code=503, detail="Governed answering is unavailable")
            try:
                current = governed_factory()
            except ValueError as error:
                raise HTTPException(
                    status_code=503, detail="Governed answering is unavailable"
                ) from error
            application.state.governed_answerer = current
        return current

    @application.post(
        "/v1/reader-summaries", response_model=ReaderSummaryResponse,
        dependencies=[Depends(authorize_service)], tags=["reader-v1"],
    )
    async def summarize_reader(
        request: ReaderSourceResponse,
        service: Annotated[ReaderSummarizer, Depends(runtime_summaries)],
    ) -> ReaderSummaryResponse:
        started = time.monotonic()
        try:
            return await service.summarize(request)
        except UnsupportedSummary as error:
            raise HTTPException(status_code=422, detail="Summary source is unsupported") from error
        except Exception as error:
            code = summary_failure(error)
            logger.warning(json.dumps({
                "event": "reader_summary_failed", "operationId": str(request.request_id),
                "stage": "GENERATION", "code": code,
                "durationMs": round((time.monotonic() - started) * 1_000),
            }))
            raise HTTPException(status_code=502, detail={"code": code}) from None

    @application.post(
        "/v1/reader-sources",
        response_model=ReaderSourceResponse,
        dependencies=[Depends(authorize_service)],
        tags=["reader-v1"],
    )
    async def prepare_reader(request: ReaderSourceRequest) -> ReaderSourceResponse:
        try:
            return await asyncio.to_thread(prepare_reader_source, request)
        except Exception as error:
            logger.warning(
                "Reader source preparation failed",
                extra={
                    "request_id": str(request.request_id),
                    "error_type": type(error).__name__,
                },
            )
            raise HTTPException(status_code=422, detail="Reader source unavailable") from error

    @application.post(
        "/v2/retrievals",
        response_model=RetrievalResponse,
        dependencies=[Depends(authorize_service)],
        tags=["answers-v2"],
    )
    async def retrieve_evidence(
        request: RetrievalRequest, service: Annotated[GovernedAnswerer, Depends(runtime_governed)]
    ) -> RetrievalResponse:
        try:
            if request.purpose == "READER_QUESTION":
                async with asyncio.timeout(60):
                    return await service.retrieve(request)
            return await service.retrieve(request)
        except Exception as error:
            logger.warning(
                "Governed retrieval failed",
                extra={"request_id": str(request.request_id), "error_type": type(error).__name__},
            )
            raise HTTPException(status_code=502, detail="Authorized retrieval failed") from error

    @application.post(
        "/v2/generations",
        response_model=GenerationResponse,
        dependencies=[Depends(authorize_service)],
        tags=["answers-v2"],
    )
    async def generate_answer(
        request: GenerationRequest, service: Annotated[GovernedAnswerer, Depends(runtime_governed)]
    ) -> GenerationResponse:
        try:
            if request.purpose == "READER_QUESTION":
                async with asyncio.timeout(110):
                    return await service.generate(request)
            return await service.generate(request)
        except UnsupportedReaderQuestion as error:
            raise HTTPException(
                status_code=422, detail="Document question input is unsupported"
            ) from error
        except Exception as error:
            logger.warning(
                "Governed generation failed",
                extra={"request_id": str(request.request_id), "error_type": type(error).__name__},
            )
            raise HTTPException(status_code=502, detail="Grounded generation failed") from error

    def runtime_indexer() -> GenerationIndexer:
        current: GenerationIndexer | None = application.state.generation_indexer
        if current is not None:
            return current
        if indexer_factory is None:
            raise HTTPException(
                status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
                detail="Indexing provider is not configured",
            )
        try:
            current = indexer_factory()
        except ValueError as error:
            raise HTTPException(
                status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
                detail="Indexing provider is not configured",
            ) from error
        application.state.generation_indexer = current
        return current

    def runtime_answerer() -> PermissionAwareAnswerer:
        current: PermissionAwareAnswerer | None = application.state.permission_aware_answerer
        if current is not None:
            return current
        if answerer_factory is None:
            raise HTTPException(
                status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
                detail="Answer provider is not configured",
            )
        try:
            current = answerer_factory()
        except ValueError as error:
            raise HTTPException(
                status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
                detail="Answer provider is not configured",
            ) from error
        application.state.permission_aware_answerer = current
        return current

    @application.get("/health/live", tags=["health"])
    async def live() -> dict[str, str]:
        return {"status": "ok"}

    @application.get("/health/ready", tags=["health"])
    async def ready() -> dict[str, str]:
        return {"status": "ready", "version": __version__}

    @application.post(
        "/v1/index-generations",
        response_model=IndexGenerationManifest,
        response_model_by_alias=True,
        tags=["indexing"],
        dependencies=[Depends(authorize_service)],
    )
    async def index_generation(
        request: IndexGenerationRequest,
        generation_indexer: Annotated[GenerationIndexer, Depends(runtime_indexer)],
    ) -> IndexGenerationManifest:
        try:
            return await generation_indexer.index(request)
        except ValueError as error:
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
                detail=str(error),
            ) from error
        except Exception as error:
            logger.exception(
                "Candidate generation indexing failed",
                extra={"generation_id": str(request.generation_id)},
            )
            raise HTTPException(
                status_code=status.HTTP_502_BAD_GATEWAY,
                detail="Candidate generation indexing failed",
            ) from error

    @application.post(
        "/v1/answers",
        response_model=AnswerResponse,
        response_model_by_alias=True,
        tags=["answers"],
        dependencies=[Depends(authorize_service)],
    )
    async def answer_question(
        request: AnswerRequest,
        permission_aware_answerer: Annotated[PermissionAwareAnswerer, Depends(runtime_answerer)],
    ) -> AnswerResponse:
        try:
            return await permission_aware_answerer.answer(request)
        except Exception as error:
            logger.exception(
                "Permission-aware answer failed",
                extra={"request_id": str(request.request_id)},
            )
            raise HTTPException(
                status_code=status.HTTP_502_BAD_GATEWAY,
                detail="Permission-aware answer failed",
            ) from error

    return application
