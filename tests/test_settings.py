from arden_ai.infrastructure.settings import Settings


def test_openai_answering_defaults_to_luna_with_high_reasoning(monkeypatch) -> None:
    monkeypatch.delenv("ARDEN_AI_OPENAI_CHAT_MODEL", raising=False)
    monkeypatch.delenv("ARDEN_AI_OPENAI_REASONING_EFFORT", raising=False)

    settings = Settings(_env_file=None)

    assert settings.openai_chat_model == "gpt-6-luna"
    assert settings.openai_reasoning_effort == "high"
