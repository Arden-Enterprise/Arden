"""Bounded OpenAI adapter for selection/page writing actions."""

import json
from typing import Literal

from langchain_core.exceptions import OutputParserException
from langchain_core.messages import HumanMessage, SystemMessage
from langchain_openai import ChatOpenAI
from pydantic import BaseModel, ConfigDict, Field

from arden_ai.application.writing import (
    PROMPTS,
    SYSTEM_PROMPT,
    InvalidWritingOutput,
    WritingOutput,
    WritingTextOutput,
)
from arden_ai.contracts.writing import WritingRequest
from arden_ai.infrastructure.settings import Settings


class _PageExplanationOutput(BaseModel):
    model_config = ConfigDict(extra="forbid")
    status: Literal["EXPLAINED"]
    text: str = Field(min_length=1, max_length=1_200)
    source_id: str = Field(min_length=2, max_length=5)


def _page_passages(text: str) -> dict[str, str]:
    # At most 150 codepoints per excerpt keeps it within Core's 300 UTF-16 unit limit.
    passages: dict[str, str] = {}
    start = 0
    while start < len(text):
        end = min(start + 150, len(text))
        if end < len(text):
            boundary = max(text.rfind("\n", end - 30, end), text.rfind(" ", end - 30, end))
            if boundary >= start:
                end = boundary + 1
        excerpt = text[start:end].strip()
        if excerpt:
            passages[f"E{len(passages) + 1}"] = excerpt
        start = end
    return passages


class OpenAIWritingProvider:
    def __init__(self, settings: Settings) -> None:
        if settings.openai_api_key is None:
            raise ValueError("Writing provider is not configured")
        model = ChatOpenAI(
            model=settings.openai_chat_model,
            api_key=settings.openai_api_key,
            reasoning={"effort": settings.openai_reasoning_effort},
            use_responses_api=True,
            max_completion_tokens=4_096,
            max_retries=0,
            timeout=45,
            output_version="responses/v1",
            store=False,
        )
        self._text = model.with_structured_output(
            WritingTextOutput,
            method="json_schema",
            strict=True,
        )
        self._page_explanation = model.with_structured_output(
            _PageExplanationOutput,
            method="json_schema",
            strict=True,
        )

    async def generate(self, request: WritingRequest) -> object:
        instruction = PROMPTS[request.action]
        needs_quote = request.action == "EXPLAIN" and request.scope == "PAGE"
        passages = _page_passages(request.text) if needs_quote else None
        payload = json.dumps(
            {"scope": request.scope, "passages": passages} if passages is not None
            else {"scope": request.scope, "text": request.text},
            ensure_ascii=False,
        )
        output = self._page_explanation if needs_quote else self._text
        try:
            result = await output.ainvoke(
                [
                    SystemMessage(content=f"{SYSTEM_PROMPT}\n{instruction}"),
                    HumanMessage(content=payload),
                ]
            )
        except OutputParserException as error:
            raise InvalidWritingOutput("provider output was invalid") from error
        if passages is not None:
            if not isinstance(result, _PageExplanationOutput) or result.source_id not in passages:
                raise InvalidWritingOutput("provider cited an unknown page passage")
            return WritingOutput(
                status=result.status, text=result.text, source_quote=passages[result.source_id],
            )
        if not isinstance(result, WritingTextOutput):
            raise InvalidWritingOutput("provider output was invalid")
        return WritingOutput(status=result.status, text=result.text, source_quote="")
