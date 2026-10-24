import hmac
import logging
from collections.abc import Callable
from typing import Annotated

from fastapi import Depends, FastAPI, Header, HTTPException, status
from pydantic import SecretStr

from arden_ai import __version__
from arden_ai.application import GenerationIndexer, PermissionAwareAnswerer
from arden_ai.contracts import (
    AnswerRequest,
    AnswerResponse,
    IndexGenerationManifest,
    IndexGenerationRequest,
)

logger = logging.getLogger(__name__)


def create_api(
    *,
    service_token: SecretStr | None,
    indexer: GenerationIndexer | None = None,
    indexer_factory: Callable[[], GenerationIndexer] | None = None,
    answerer: PermissionAwareAnswerer | None = None,
    answerer_factory: Callable[[], PermissionAwareAnswerer] | None = None,
) -> FastAPI:
    application = FastAPI(
        title="Arden AI",
        summary="Internal permission-aware retrieval and generation service",
        version=__version__,
    )
    application.state.generation_indexer = indexer
    application.state.permission_aware_answerer = answerer

    def authorize_service(
        authorization: Annotated[str | None, Header()] = None,
    ) -> None:
        if service_token is None:
            raise HTTPException(
                status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
                detail="Service authentication is not configured",
            )

        scheme, separator, credential = (authorization or "").partition(" ")
        valid = (
            bool(separator)
            and scheme.lower() == "bearer"
            and hmac.compare_digest(credential, service_token.get_secret_value())
        )
        if not valid:
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="Invalid service credentials",
                headers={"WWW-Authenticate": "Bearer"},
            )

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
        current: PermissionAwareAnswerer | None = (
            application.state.permission_aware_answerer
        )
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
        permission_aware_answerer: Annotated[
            PermissionAwareAnswerer, Depends(runtime_answerer)
        ],
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
