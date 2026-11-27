import pytest
from pydantic import ValidationError

from arden_ai.infrastructure.settings import Settings


def test_openai_answering_defaults_to_luna_with_high_reasoning(monkeypatch) -> None:
    monkeypatch.delenv("ARDEN_AI_OPENAI_CHAT_MODEL", raising=False)
    monkeypatch.delenv("ARDEN_AI_OPENAI_REASONING_EFFORT", raising=False)

    settings = Settings(_env_file=None)

    assert settings.openai_chat_model == "gpt-6-luna"
    assert settings.openai_reasoning_effort == "high"


def test_settings_accepts_staging_environment_and_rejects_unknown(monkeypatch) -> None:
    monkeypatch.setenv("ARDEN_AI_ENVIRONMENT", "staging")
    settings = Settings(_env_file=None)
    assert settings.environment == "staging"

    monkeypatch.setenv("ARDEN_AI_ENVIRONMENT", "invalid-env")
    with pytest.raises(ValidationError):
        Settings(_env_file=None)
