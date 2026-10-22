import hmac
import logging
from typing import Annotated

from fastapi import Depends, FastAPI, Header, HTTPException, status

from arden_ai import __version__
from arden_ai.config import Settings, get_settings
from arden_ai.contracts import IndexGenerationManifest, IndexGenerationRequest
from arden_ai.pipeline import GenerationIndexer
from arden_ai.providers import ChromaCandidateGenerationStore

logger = logging.getLogger(__name__)


def create_app(
    *,
    settings: Settings | None = None,
    indexer: GenerationIndexer | None = None,
) -> FastAPI:
    service_settings = settings or get_settings()
    application = FastAPI(
        title="Arden AI",
        summary="Internal permission-aware retrieval and generation service",
        version=__version__,
    )
    application.state.generation_indexer = indexer

    def authorize_service(
        authorization: Annotated[str | None, Header()] = None,
    ) -> None:
        configured_token = service_settings.service_token
        if configured_token is None:
            raise HTTPException(
                status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
                detail="Service authentication is not configured",
            )

        scheme, separator, credential = (authorization or "").partition(" ")
        valid = (
            bool(separator)
            and scheme.lower() == "bearer"
            and hmac.compare_digest(credential, configured_token.get_secret_value())
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
        try:
            current = GenerationIndexer(ChromaCandidateGenerationStore(service_settings))
        except ValueError as error:
            raise HTTPException(
                status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
                detail="Indexing provider is not configured",
            ) from error
        application.state.generation_indexer = current
        return current

    @application.get("/health/live", tags=["health"])
    async def live() -> dict[str, str]:
        return {"status": "ok"}

    @application.get("/health/ready", tags=["health"])
    async def ready() -> dict[str, str]:
        # Active dependency probes belong in the deployment integration phase.
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

    return application


app = create_app()

