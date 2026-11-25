"""Bounded OpenAI adapter for selection/page writing actions."""

import json

from langchain_core.exceptions import OutputParserException
from langchain_core.messages import HumanMessage, SystemMessage
from langchain_openai import ChatOpenAI

from arden_ai.application.writing import (
    PROMPTS,
    SYSTEM_PROMPT,
    InvalidWritingOutput,
    WritingOutput,
    WritingTextOutput,
)
from arden_ai.contracts.writing import WritingRequest
from arden_ai.infrastructure.settings import Settings


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
            WritingOutput,
            method="json_schema",
            strict=True,
        )

    async def generate(self, request: WritingRequest) -> object:
        instruction = PROMPTS[request.action]
        payload = json.dumps({"scope": request.scope, "text": request.text}, ensure_ascii=False)
        needs_quote = request.action == "EXPLAIN" and request.scope == "PAGE"
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
        if needs_quote:
            return result
        if not isinstance(result, WritingTextOutput):
            raise InvalidWritingOutput("provider output was invalid")
        return WritingOutput(status=result.status, text=result.text, source_quote="")
