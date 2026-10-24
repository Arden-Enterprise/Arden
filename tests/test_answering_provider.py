from arden_ai.contracts import AnswerRequest
from arden_ai.infrastructure.answering import _permission_filter


def test_chroma_filter_requires_organization_and_core_generation_allow_list() -> None:
    request = AnswerRequest.model_validate(
        {
            "requestId": "10000000-0000-4000-8000-000000000001",
            "organizationId": "10000000-0000-4000-8000-000000000002",
            "query": "MFA",
            "allowedGenerationIds": [
                "10000000-0000-4000-8000-000000000003",
                "10000000-0000-4000-8000-000000000004",
            ],
        }
    )

    assert _permission_filter(request) == {
        "$and": [
            {"organization_id": "10000000-0000-4000-8000-000000000002"},
            {
                "generation_id": {
                    "$in": [
                        "10000000-0000-4000-8000-000000000003",
                        "10000000-0000-4000-8000-000000000004",
                    ]
                }
            },
        ]
    }
