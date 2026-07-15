from __future__ import annotations

import json
import logging
import time
from dataclasses import dataclass
from typing import Any

from pydantic import ValidationError

from src.config import get_settings
from src.llm_client import BaseLLMClient, get_llm_client
from src.logging_utils import safe_brief_summary
from src.schemas import Brief, ProductSpec


logger = logging.getLogger("creative_lab.spec_retry")


@dataclass
class ExtractionResult:
    spec: ProductSpec
    raw_output: str
    parsed_json: dict[str, Any]
    attempt_errors: list[str]


class SpecExtractionError(RuntimeError):
    def __init__(
        self,
        message: str,
        attempt_errors: list[str],
        last_raw_output: str | None = None,
    ) -> None:
        super().__init__(message)
        self.attempt_errors = attempt_errors
        self.last_raw_output = last_raw_output


def extract_spec_with_retries(
    brief: Brief,
    client: BaseLLMClient | None = None,
    max_attempts: int | None = None,
) -> ExtractionResult:
    settings = get_settings()
    client = client or get_llm_client(settings)
    max_attempts = max_attempts or settings.max_retries
    attempt_errors: list[str] = []
    last_raw_output: str | None = None
    previous_error: str | None = None

    for attempt in range(1, max_attempts + 1):
        logger.info("Spec extraction attempt %s input=%s", attempt, safe_brief_summary(brief))
        try:
            raw_output = client.generate_spec_json(brief, previous_error=previous_error)
            last_raw_output = raw_output
            logger.info("Spec extraction attempt %s raw_output=%s", attempt, raw_output)

            parsed_json = parse_json_object(raw_output)
            logger.info(
                "Spec extraction attempt %s parsed_json=%s",
                attempt,
                json.dumps(parsed_json, ensure_ascii=False),
            )

            spec = ProductSpec.model_validate(parsed_json)
            logger.info("Spec extraction attempt %s validation=success result=%s", attempt, spec.model_dump_json())
            return ExtractionResult(
                spec=spec,
                raw_output=raw_output,
                parsed_json=parsed_json,
                attempt_errors=attempt_errors,
            )
        except (json.JSONDecodeError, ValidationError, ValueError) as exc:
            error = f"第 {attempt} 次解析/校验失败: {exc}"
            attempt_errors.append(error)
            previous_error = error
            logger.warning(error, exc_info=True)
        except Exception as exc:
            error = f"第 {attempt} 次 LLM 调用失败: {exc}"
            attempt_errors.append(error)
            previous_error = error
            logger.warning(error, exc_info=True)

        if attempt < max_attempts:
            time.sleep(min(2 ** (attempt - 1), 6))

    raise SpecExtractionError(
        f"生成 Spec 失败：已重试 {max_attempts} 次，仍未得到合规 JSON。",
        attempt_errors=attempt_errors,
        last_raw_output=last_raw_output,
    )


def parse_json_object(raw_output: str) -> dict[str, Any]:
    text = raw_output.strip()
    if text.startswith("```"):
        lines = text.splitlines()
        if lines and lines[0].startswith("```"):
            lines = lines[1:]
        if lines and lines[-1].startswith("```"):
            lines = lines[:-1]
        text = "\n".join(lines).strip()

    try:
        parsed = json.loads(text)
    except json.JSONDecodeError:
        start = text.find("{")
        end = text.rfind("}")
        if start == -1 or end == -1 or end <= start:
            raise
        parsed = json.loads(text[start : end + 1])

    if not isinstance(parsed, dict):
        raise ValueError("LLM 输出必须是 JSON object")
    return parsed
