import json
from collections.abc import Sequence
from hashlib import sha256
from pathlib import Path
from uuid import UUID

from fastapi.testclient import TestClient
from pydantic import SecretStr

from arden_ai.contracts.maintenance_analysis import (
    MaintenanceAnalysisRequest,
    MaintenanceEvidence,
)
from arden_ai.presentation.api import create_api


def test_maintenance_analysis_fixture_matches_the_bounded_contract() -> None:
    payload = json.loads(
        Path("tests/fixtures/maintenance-analysis-v1.json").read_text(encoding="utf-8")
    )
    request = MaintenanceAnalysisRequest.model_validate(payload)
    assert request.contract_version == 1
    assert len(request.version_ids) == 1


def test_maintenance_routes_keep_v1_and_require_explicit_v2_provider() -> None:
    data = json.loads(
        Path("tests/fixtures/maintenance-analysis-v1.json").read_text(encoding="utf-8")
    )
    client = TestClient(create_api(service_token=SecretStr("synthetic-test")))
    headers = {"Authorization": "Bearer synthetic-test"}
    controlled = client.post("/v1/maintenance-analyses", json=data, headers=headers)
    assert controlled.status_code == 200
    assert controlled.json()["findings"][0]["versionId"] == data["versionIds"][0]

    text = "A synthetic installation step."
    source = {
        "versionId": data["versionIds"][0],
        "text": text,
        "textHash": sha256(text.encode()).hexdigest(),
    }
    payload = {
        "contractVersion": 2,
        "requestId": "10000000-0000-4000-8000-000000000099",
        "caseId": data["caseId"],
        "sources": [source],
    }
    path = "/v2/maintenance-analyses"
    assert client.post(path, json=payload).status_code == 401
    assert client.post(path, json=payload, headers=headers).status_code == 503

    calls: list[UUID] = []
    quote = "installation step"

    async def fake_provider(sources: Sequence[MaintenanceEvidence]) -> object:
        calls.extend(item.version_id for item in sources)
        return {
            "findings": [
                {
                    "versionId": str(sources[0].version_id),
                    "summary": "Explains installation.",
                    "quote": quote,
                }
            ]
        }

    enabled = TestClient(
        create_api(
            service_token=SecretStr("synthetic-test"),
            maintenance_factory=lambda: fake_provider,
        )
    )
    invalid = enabled.post(
        path,
        headers=headers,
        json={**payload, "sources": [{**source, "textHash": "0" * 64}]},
    )
    assert invalid.status_code == 422
    assert text not in invalid.text
    assert calls == []

    accepted = enabled.post(path, json=payload, headers=headers)
    assert accepted.status_code == 200
    assert calls == [UUID(str(source["versionId"]))]
    body = accepted.json()
    assert body["contractVersion"] == 2
    assert body["state"] == "succeeded"
    assert body["findings"][0]["textHash"] == source["textHash"]
    assert body["findings"][0]["quote"] == quote

    without_request_id = {k: v for k, v in payload.items() if k != "requestId"}
    assert enabled.post(path, json=without_request_id, headers=headers).status_code == 200

    quote = "Fabricated passage"
    rejected = enabled.post(path, json=payload, headers=headers)
    assert rejected.status_code == 502
    assert quote not in rejected.text
