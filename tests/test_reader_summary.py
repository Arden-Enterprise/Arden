"""Reader Summary acceptance without network, shared indexes or provider spend."""

import asyncio
import hashlib
import json
from pathlib import Path

import pytest
from fastapi.testclient import TestClient
from jsonschema import Draft202012Validator
from langchain_core.messages import HumanMessage
from pydantic import SecretStr

from arden_ai.application.reader_summary import (
    InvalidSummary,
    ReaderSummarizer,
    UnsupportedSummary,
    WindowOutput,
    plan_summary,
    validate_window,
)
from arden_ai.contracts.export_schemas import build_schemas
from arden_ai.contracts.reader import ReaderSourceResponse
from arden_ai.contracts.reader_summary import ReaderSummaryResponse
from arden_ai.infrastructure.reader_summary import OpenAISummaryGenerator
from arden_ai.infrastructure.settings import Settings
from arden_ai.presentation.api import create_api


def source(text: str | None = None) -> ReaderSourceResponse:
    fixture = Path(__file__).parent / "fixtures/reader-source-v1.json"
    data = json.loads(fixture.read_text(encoding="utf-8"))["response"]
    if text is not None:
        data["markdown"] = text
        data["markdownContentHash"] = hashlib.sha256(text.encode()).hexdigest()
        chunks = []
        for ordinal, start in enumerate(range(0, len(text), 4_000)):
            content = text[start:start + 4_000]
            chunks.append({**data["chunks"][0], "ordinal": ordinal,
                           "chunkId": f"{ordinal:064x}", "startOffset": start,
                           "endOffset": start + len(content), "content": content,
                           "contentHash": hashlib.sha256(content.encode()).hexdigest()})
        data["chunks"] = chunks
        data["chunksDigest"] = hashlib.sha256(json.dumps(
            [{k: v for k, v in c.items() if k != "content"} for c in chunks],
            separators=(",", ":"), sort_keys=True,
        ).encode()).hexdigest()
    return ReaderSourceResponse.model_validate(data)


def output(window):
    item = max(window.evidence, key=lambda e: min(e.start + len(e.text), window.end)
               - max(e.start, window.start))
    start = max(window.start - item.start, 0)
    quote = item.text[start:start + min(1_000, window.end - max(window.start, item.start))]
    return {"points": [{"kind": "KEY_POINT", "text": "Source-bound outline.",
                        "citations": [{"evidence_id": item.evidence_id, "quote": quote}]}]}


class Generator:
    def __init__(self, mutation=None):
        self.calls = []
        self.mutation = mutation

    async def generate(self, window):
        self.calls.append(window)
        result = output(window)
        return self.mutation(result) if self.mutation else result


def test_complete_text_including_tail_and_headings_not_top_k() -> None:
    text = "\n".join(f"Section {i}: exact rule number {i} 🔐, with its own condition."
                     for i in range(310))
    prepared, generator = source(text), Generator()
    windows = plan_summary(prepared)
    assert 1 < len(windows) <= 8
    result = asyncio.run(ReaderSummarizer(generator).summarize(prepared))
    assert len(generator.calls) == len(windows)
    assert result.coverage[0].start_offset == 0
    assert result.coverage[-1].end_offset == len(text)
    assert all(a.end_offset == b.start_offset for a, b in zip(
        result.coverage, result.coverage[1:], strict=False))
    assert "Section 309" in generator.calls[-1].payload
    assert result.used_chunk_ids == [chunk.chunk_id for chunk in prepared.chunks]
    assert result.request_id == prepared.request_id
    assert len(result.points) == len(windows)


@pytest.mark.parametrize("text", [" " * 100, "a" * 60_000, "漢字🌟" * 18_000],
                         ids=["blank", "too-many-windows", "token-heavy"])
def test_unsupported_whole_plan_has_zero_model_calls(text) -> None:
    generator = Generator()
    with pytest.raises(UnsupportedSummary):
        asyncio.run(ReaderSummarizer(generator).summarize(source(text)))
    assert not generator.calls


@pytest.mark.parametrize("mutation", ["unknown", "wording", "empty", "extra", "long", "no-quote"])
def test_invalid_output_has_one_identical_input_repair_then_fails(mutation) -> None:
    def mutate(value):
        if mutation == "unknown":
            value["points"][0]["citations"][0]["evidence_id"] = "E999"
        elif mutation == "wording":
            value["points"][0]["citations"][0]["quote"] = "Readers may reuse cached summaries."
        elif mutation == "empty":
            value["points"] = []
        elif mutation == "extra":
            value["secret"] = True
        elif mutation == "long":
            value["points"][0]["text"] = "x" * 351
        else:
            value["points"][0]["citations"] = []
        return value

    generator = Generator(mutate)
    with pytest.raises(ExceptionGroup):
        asyncio.run(ReaderSummarizer(generator).summarize(source()))
    assert len(generator.calls) == 2
    assert generator.calls[0] == generator.calls[1]


def test_whitespace_alignment_preserves_raw_span_and_repeated_words_fail() -> None:
    prepared = source("🔐\nReaders must not\n reuse cached summaries.\n")
    generator = Generator(lambda value: {"points": [{"kind": "CONDITION",
        "text": "Do not reuse cached summaries.", "citations": [{"evidence_id": "E1",
        "quote": "Readers must not reuse cached summaries."}]}]})
    result = asyncio.run(ReaderSummarizer(generator).summarize(prepared))
    assert result.points[0].citations[0].quote == "Readers must not\n reuse cached summaries."
    repeated = Generator(lambda value: {"points": [{"kind": "KEY_POINT", "text": "Rule",
        "citations": [{"evidence_id": "E1", "quote": "Same rule"}]}]})
    with pytest.raises(ExceptionGroup):
        asyncio.run(ReaderSummarizer(repeated).summarize(source("Same rule. Same rule.")))


def test_synthesis_retains_condition_exception_and_deduplicates_only_identical() -> None:
    def mutate(value):
        point = value["points"][0]
        return {"points": [point, {**point, "kind": "CONDITION"}, {**point, "kind": "EXCEPTION"}]}
    result = asyncio.run(ReaderSummarizer(Generator(mutate)).summarize(source()))
    assert [p.kind for p in result.points] == ["KEY_POINT", "CONDITION", "EXCEPTION"]
    duplicate = Generator(lambda value: {"points": value["points"] * 3})
    assert len(asyncio.run(ReaderSummarizer(duplicate).summarize(source())).points) == 1


def test_transport_failure_is_not_retried_and_cancels_sibling_windows() -> None:
    class FailingGenerator:
        calls = 0
        cancelled = 0

        async def generate(self, window):
            self.calls += 1
            if window.start == 0:
                await asyncio.sleep(0)
                raise RuntimeError("provider failure with private text")
            try:
                await asyncio.sleep(10)
            finally:
                self.cancelled += 1

    generator = FailingGenerator()
    prepared = source("\n".join(f"Unique rule {i}: retain the required condition."
                                for i in range(300)))
    with pytest.raises(ExceptionGroup):
        asyncio.run(ReaderSummarizer(generator).summarize(prepared))
    assert generator.calls == 2
    assert generator.cancelled == 1


def test_provider_timeout_releases_all_work(monkeypatch) -> None:
    timeout = asyncio.timeout
    monkeypatch.setattr("arden_ai.application.reader_summary.asyncio.timeout",
                        lambda seconds: timeout(0.01 if seconds == 45 else 0.1))

    class Slow:
        cancelled = False

        async def generate(self, window):
            try:
                await asyncio.sleep(10)
            finally:
                self.cancelled = True

    generator = Slow()
    with pytest.raises(ExceptionGroup):
        asyncio.run(ReaderSummarizer(generator).summarize(source()))
    assert generator.cancelled


def test_authenticated_http_safe_failures_and_additive_schema(caplog) -> None:
    app = create_api(service_token=SecretStr("test-only"), summaries=ReaderSummarizer(Generator()))
    payload = source().model_dump(mode="json", by_alias=True)
    with TestClient(app) as client:
        assert client.post("/v1/reader-summaries", json=payload).status_code == 401
        response = client.post("/v1/reader-summaries", json=payload,
                               headers={"Authorization": "Bearer test-only"})
        assert response.status_code == 200
        schema = build_schemas()["reader-summary-v1.schema.json"]
        Draft202012Validator({"$ref": "#/$defs/ReaderSummaryResponse", **schema}).validate(
            response.json())
        assert "markdown" not in response.json()
        broken = {**payload, "markdown": "forged"}
        assert client.post("/v1/reader-summaries", json=broken,
                           headers={"Authorization": "Bearer test-only"}).status_code == 422

    class Broken:
        async def generate(self, window):
            raise RuntimeError("private error and evidence")
    failed = create_api(service_token=SecretStr("test-only"), summaries=ReaderSummarizer(Broken()))
    with TestClient(failed) as client:
        response = client.post("/v1/reader-summaries", json=payload,
                               headers={"Authorization": "Bearer test-only"})
        assert response.status_code == 502
        assert "private error" not in response.text + caplog.text
    unsupported = source("x" * 60_000).model_dump(mode="json", by_alias=True)
    with TestClient(app) as client:
        assert client.post("/v1/reader-summaries", json=unsupported,
                           headers={"Authorization": "Bearer test-only"}).status_code == 422


def test_paired_summary_golden_fixture_matches_source_and_exported_schema() -> None:
    path = Path(__file__).parent / "fixtures/reader-summary-v1.json"
    payload = json.loads(path.read_text(encoding="utf-8"))
    result, prepared = ReaderSummaryResponse.model_validate(payload), source()
    assert result.request_id == prepared.request_id
    assert result.coverage[-1].end_offset == len(prepared.markdown)
    assert result.used_chunk_ids == [c.chunk_id for c in prepared.chunks]
    schema = build_schemas()["reader-summary-v1.schema.json"]
    Draft202012Validator({"$ref": "#/$defs/ReaderSummaryResponse", **schema}).validate(payload)
    assert result.points[0].citations[0].quote in prepared.chunks[0].content


def test_overlapping_evidence_cannot_exceed_serialized_prompt_envelope() -> None:
    data = source("\n".join(f"Unique rule {i} must retain this condition." for i in range(40)))
    payload = data.model_dump(mode="json", by_alias=True)
    payload["chunks"] = [{**payload["chunks"][0], "ordinal": i, "chunkId": f"{i:064x}"}
                         for i in range(100)]
    payload["chunksDigest"] = hashlib.sha256(json.dumps(
        [{k: v for k, v in c.items() if k != "content"} for c in payload["chunks"]],
        separators=(",", ":"), sort_keys=True,
    ).encode()).hexdigest()
    generator = Generator()
    with pytest.raises(UnsupportedSummary):
        asyncio.run(ReaderSummarizer(generator).summarize(
            ReaderSourceResponse.model_validate(payload)))
    assert not generator.calls


def test_window_concurrency_never_exceeds_two_and_all_workers_are_awaited() -> None:
    class Concurrent:
        active = 0
        maximum = 0
        completed = 0

        async def generate(self, window):
            self.active += 1
            self.maximum = max(self.maximum, self.active)
            try:
                await asyncio.sleep(0)
                self.completed += 1
                return output(window)
            finally:
                self.active -= 1

    generator = Concurrent()
    prepared = source("\n".join(f"Unique rule {i} must retain this condition."
                                for i in range(360)))
    result = asyncio.run(ReaderSummarizer(generator).summarize(prepared))
    assert generator.maximum == 2 and generator.active == 0
    assert generator.completed == len(result.coverage) > 2


def test_structured_parser_failure_gets_only_one_same_input_repair() -> None:
    class Repair:
        def __init__(self):
            self.calls = []

        async def generate(self, window):
            self.calls.append(window)
            if len(self.calls) == 1:
                raise InvalidSummary("structured output failed")
            return output(window)

    generator = Repair()
    assert asyncio.run(ReaderSummarizer(generator).summarize(source())).status == "COMPLETED"
    assert len(generator.calls) == 2 and generator.calls[0] == generator.calls[1]


def test_neighboring_context_cannot_substitute_for_primary_passage_evidence() -> None:
    prepared = source("\n".join(f"Unique rule {i} must retain this condition."
                                for i in range(360)))
    window = plan_summary(prepared)[1]
    item = next(e for e in window.evidence if e.start < window.start - 100)
    value = {"points": [{"kind": "KEY_POINT", "text": "A previous passage is not this passage.",
                        "citations": [{"evidence_id": item.evidence_id,
                                       "quote": item.text[:100]}]}]}
    with pytest.raises(InvalidSummary, match="neighboring context"):
        validate_window(value, window, prepared)


def test_summary_provider_options_and_messages_without_network(monkeypatch) -> None:
    captured = {}

    class FakeModel:
        def __init__(self, **kwargs):
            captured.update(kwargs)

        def with_structured_output(self, schema, **kwargs):
            assert schema is WindowOutput and kwargs == {"method": "json_schema", "strict": True}
            return self

        async def ainvoke(self, messages):
            captured["messages"] = messages
            return output(plan_summary(source())[0])

    monkeypatch.setattr("arden_ai.infrastructure.reader_summary.ChatOpenAI", FakeModel)
    settings = Settings(openai_api_key=SecretStr("test-only"), _env_file=None)
    generator = OpenAISummaryGenerator(settings)
    window = plan_summary(source())[0]
    asyncio.run(generator.generate(window))
    assert captured["model"] == "gpt-6-luna"
    assert captured["reasoning"] == {"effort": "high"}
    assert captured["store"] is False and captured["max_retries"] == 0
    assert captured["max_completion_tokens"] == 4_096 and captured["timeout"] == 45
    assert isinstance(captured["messages"][1], HumanMessage)
    assert captured["messages"][1].content == window.payload


def test_installed_adapter_maps_output_limit_to_responses_without_request() -> None:
    from langchain_openai import ChatOpenAI

    model = ChatOpenAI(model="gpt-6-luna", api_key=SecretStr("test-only"), use_responses_api=True,
                       max_completion_tokens=4_096, store=False, max_retries=0,
                       reasoning={"effort": "high"})
    payload = model._get_request_payload([HumanMessage(content="test")])
    assert payload["max_output_tokens"] == 4_096
    assert payload["store"] is False
    assert payload["reasoning"] == {"effort": "high"}
