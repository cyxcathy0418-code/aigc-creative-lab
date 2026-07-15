from __future__ import annotations

import base64
from abc import ABC, abstractmethod
from typing import Any

from openai import OpenAI

from src.config import Settings, get_settings
from src.prompts import format_derivation_prompt, format_spec_prompt
from src.schemas import (
    Brief,
    DerivationContext,
    MarketCreativeDraftSet,
    ProductSpec,
)


class BaseLLMClient(ABC):
    @abstractmethod
    def generate_spec_json(self, brief: Brief, previous_error: str | None = None) -> str:
        """Return the raw JSON text produced by the model."""

    @abstractmethod
    def generate_derivation_json(
        self,
        spec: ProductSpec,
        context: DerivationContext,
        previous_error: str | None = None,
    ) -> str:
        """Return the raw JSON text for market creative derivation."""


class OpenAIResponsesClient(BaseLLMClient):
    def __init__(self, settings: Settings | None = None) -> None:
        self.settings = settings or get_settings()
        if not self.settings.openai_api_key:
            raise RuntimeError("未检测到 OPENAI_API_KEY，请确认 .env 已配置。")
        self.client = OpenAI(
            api_key=self.settings.openai_api_key,
            timeout=self.settings.request_timeout,
        )

    def generate_spec_json(self, brief: Brief, previous_error: str | None = None) -> str:
        content: list[dict[str, Any]] = [
            {
                "type": "input_text",
                "text": format_spec_prompt(brief, previous_error=previous_error),
            }
        ]

        for image in brief.images:
            encoded = base64.b64encode(image.data).decode("utf-8")
            content.append(
                {
                    "type": "input_image",
                    "image_url": f"data:{image.mime_type};base64,{encoded}",
                }
            )

        response = self.client.responses.create(
            model=self.settings.openai_model,
            input=[
                {
                    "role": "user",
                    "content": content,
                }
            ],
            temperature=0.2,
            max_output_tokens=2200,
            text={
                "format": {
                    "type": "json_schema",
                    "name": "product_spec",
                    "schema": ProductSpec.model_json_schema(),
                    "strict": True,
                }
            },
        )
        return _response_to_text(response)

    def generate_derivation_json(
        self,
        spec: ProductSpec,
        context: DerivationContext,
        previous_error: str | None = None,
    ) -> str:
        response = self.client.responses.create(
            model=self.settings.openai_model,
            input=[
                {
                    "role": "user",
                    "content": [
                        {
                            "type": "input_text",
                            "text": format_derivation_prompt(
                                spec,
                                context,
                                previous_error=previous_error,
                            ),
                        }
                    ],
                }
            ],
            temperature=0.55,
            max_output_tokens=6000,
            text={
                "format": {
                    "type": "json_schema",
                    "name": "market_creative_derivation",
                    "schema": MarketCreativeDraftSet.model_json_schema(),
                    "strict": True,
                }
            },
        )
        return _response_to_text(response)


class MockBadJsonClient(BaseLLMClient):
    def generate_spec_json(self, brief: Brief, previous_error: str | None = None) -> str:
        return "{ bad json: true, missing_quotes: }"

    def generate_derivation_json(
        self,
        spec: ProductSpec,
        context: DerivationContext,
        previous_error: str | None = None,
    ) -> str:
        return "{ bad json: true, missing_quotes: }"


def get_llm_client(settings: Settings | None = None) -> BaseLLMClient:
    settings = settings or get_settings()
    if settings.llm_provider == "openai":
        return OpenAIResponsesClient(settings)
    if settings.llm_provider == "mock_bad_json":
        return MockBadJsonClient()
    raise ValueError(f"暂不支持的 LLM_PROVIDER: {settings.llm_provider}")


def _response_to_text(response: Any) -> str:
    output_text = getattr(response, "output_text", None)
    if output_text:
        return str(output_text).strip()

    chunks: list[str] = []
    for output_item in getattr(response, "output", []) or []:
        for content_item in getattr(output_item, "content", []) or []:
            text = getattr(content_item, "text", None)
            if text is None and isinstance(content_item, dict):
                text = content_item.get("text")
            if text:
                chunks.append(str(text))
    return "".join(chunks).strip()
