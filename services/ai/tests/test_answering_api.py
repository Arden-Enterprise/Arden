from fastapi.testclient import TestClient

from arden_ai.application import GeneratedAnswer, PermissionAwareAnswerer
from arden_ai.contracts import AnswerRequest
from arden_ai.infrastructure import Settings
from arden_ai.main import create_app


class EmptyRetriever:
    async def retrieve(self, request: AnswerRequest, limit: int):  # type: ignore[no-untyped-def]
        return ()


class UnusedGenerator:
    async def generate(self, query: str, evidence: tuple):  # type: ignore[type-arg]
        return GeneratedAnswer("unused", ())


def payload() -> dict[str, object]:
    return {
        "requestId": "10000000-0000-4000-8000-000000000001",
        "organizationId": "10000000-0000-4000-8000-000000000002",
        "query": "What is the policy?",
        "allowedGenerationIds": ["10000000-0000-4000-8000-000000000003"],
    }


def test_answer_endpoint_requires_service_authentication() -> None:
    client = TestClient(create_app(settings=Settings(service_token="test-token")))

    response = client.post("/v1/answers", json=payload())

    assert response.status_code == 401


def test_answer_endpoint_returns_honest_abstention() -> None:
    answerer = PermissionAwareAnswerer(EmptyRetriever(), UnusedGenerator())
    client = TestClient(
        create_app(settings=Settings(service_token="test-token"), answerer=answerer)
    )

    response = client.post(
        "/v1/answers",
        json=payload(),
        headers={"Authorization": "Bearer test-token"},
    )

    assert response.status_code == 200
    assert response.json()["status"] == "INSUFFICIENT_EVIDENCE"
    assert response.json()["citations"] == []
