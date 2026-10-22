from typing import Protocol

from arden_ai.contracts import IndexGenerationRequest
from arden_ai.pipeline.preparation import PreparedGeneration


class CandidateGenerationStore(Protocol):
    @property
    def embedding_model(self) -> str: ...

    @property
    def embedding_dimensions(self) -> int: ...

    async def replace_candidate(
        self, request: IndexGenerationRequest, prepared: PreparedGeneration
    ) -> None: ...

