import base64
import hashlib
import io
from uuid import uuid4

from fastapi.testclient import TestClient
from pydantic import SecretStr
from pypdf import PdfWriter
from pypdf.generic import (
    DecodedStreamObject,
    DictionaryObject,
    NameObject,
)

from arden_ai.application.submission_review import ModelReview, SubmissionReviewer
from arden_ai.contracts.submission_review import ReviewCitation
from arden_ai.presentation.api import create_api


class Provider:
    def __init__(self, source_id: str = "S1") -> None:
        self.passages: dict[str, ReviewCitation] = {}
        self.source_id = source_id

    async def generate(self, passages: dict[str, ReviewCitation]) -> ModelReview:
        self.passages = passages
        return ModelReview.model_validate({
            "summary": [{"text": "Managers approve exceptions.", "source_id": self.source_id}],
            "checks": [{
                "category": "CLARITY",
                "text": "Verify which managers are responsible.",
                "source_id": self.source_id,
            }],
        })


def client(provider: Provider) -> TestClient:
    return TestClient(create_api(
        service_token=SecretStr("synthetic-token"),
        submission_reviewer=SubmissionReviewer(provider),
    ))


def payload(source: str | bytes) -> dict[str, object]:
    is_pdf = isinstance(source, bytes)
    data = source.encode() if isinstance(source, str) else source
    return {
        "contractVersion": 1,
        "requestId": str(uuid4()),
        "snapshotVersionId": str(uuid4()),
        "snapshotContentHash": hashlib.sha256(data).hexdigest(),
        **({"mimeType": "application/pdf", "pdfBase64": base64.b64encode(data).decode()}
           if is_pdf else {"mimeType": "text/plain", "content": source}),
    }


PATH = "/v1/submission-reviews"
AUTH = {"Authorization": "Bearer synthetic-token"}


def test_service_auth_snapshot_integrity_and_grounded_result() -> None:
    provider = Provider()
    api = client(provider)
    text = "Managers approve\nexceptions after checking eligibility."
    body = payload(text)
    assert api.post(PATH, json=body).status_code == 401
    invalid = api.post(PATH, json={**body, "content": "replaced source"}, headers=AUTH)
    assert invalid.status_code == 422
    assert "replaced source" not in invalid.text
    assert not provider.passages

    response = api.post(PATH, json=body, headers=AUTH)
    assert response.status_code == 200
    result = response.json()
    assert result["snapshotVersionId"] == body["snapshotVersionId"]
    assert result["summary"][0]["citation"] == {"excerpt": text, "page": None}
    assert result["checks"][0]["citation"] == {"excerpt": text, "page": None}
    assert "decision" not in result


def test_rejects_unknown_ids_and_does_not_review_over_limit_text() -> None:
    provider = Provider("S99")
    api = client(provider)
    assert api.post(PATH, json=payload("a" * 32_001), headers=AUTH).status_code == 422
    assert not provider.passages
    response = api.post(PATH, json=payload("Evidence with one source."), headers=AUTH)
    assert response.status_code == 502
    assert response.json()["detail"]["code"] == "INVALID_OUTPUT"


def test_pdf_citation_keeps_the_original_page_number() -> None:
    writer = PdfWriter()
    writer.add_blank_page(width=300, height=200)
    page = writer.add_blank_page(width=300, height=200)
    page[NameObject("/Resources")] = DictionaryObject({
        NameObject("/Font"): DictionaryObject({
            NameObject("/F1"): DictionaryObject({
                NameObject("/Type"): NameObject("/Font"),
                NameObject("/Subtype"): NameObject("/Type1"),
                NameObject("/BaseFont"): NameObject("/Helvetica"),
            })
        })
    })
    stream = DecodedStreamObject()
    stream.set_data(b"BT /F1 12 Tf 20 100 Td (Managers approve exceptions.) Tj ET")
    page.replace_contents(stream)
    output = io.BytesIO()
    writer.write(output)

    response = client(Provider()).post(PATH, json=payload(output.getvalue()), headers=AUTH)
    assert response.status_code == 200
    assert response.json()["summary"][0]["citation"] == {
        "excerpt": "Managers approve exceptions.", "page": 2,
    }
