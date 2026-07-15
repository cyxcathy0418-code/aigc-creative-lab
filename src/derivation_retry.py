from __future__ import annotations

import json
import logging
import time
from dataclasses import dataclass
from typing import Any

from pydantic import ValidationError

from src.config import get_settings
from src.llm_client import BaseLLMClient, get_llm_client
from src.prompts import ANCHOR_REFERENCE_FIELDS, build_anchor_block
from src.retry import parse_json_object
from src.schemas import (
    DerivationContext,
    MarketCreative,
    MarketCreativeDraft,
    MarketCreativeDraftSet,
    MarketCreativeSet,
    ProductSpec,
    PromptArtifact,
)


logger = logging.getLogger("creative_lab.derivation_retry")


@dataclass
class DerivationResult:
    creatives: MarketCreativeSet
    raw_output: str
    parsed_json: dict[str, Any]
    attempt_errors: list[str]


class CreativeDerivationError(RuntimeError):
    def __init__(
        self,
        message: str,
        attempt_errors: list[str],
        last_raw_output: str | None = None,
    ) -> None:
        super().__init__(message)
        self.attempt_errors = attempt_errors
        self.last_raw_output = last_raw_output


def derive_creatives_with_retries(
    spec: ProductSpec,
    context: DerivationContext,
    client: BaseLLMClient | None = None,
    max_attempts: int | None = None,
) -> DerivationResult:
    settings = get_settings()
    client = client or get_llm_client(settings)
    max_attempts = max_attempts or settings.max_retries
    attempt_errors: list[str] = []
    last_raw_output: str | None = None
    previous_error: str | None = None
    input_summary = {
        "product": spec.product_identity.name,
        "markets": context.target_markets,
        "platform": context.platform,
        "style_preference": context.style_preference,
        "anchor_sentence": spec.anchor_sentence,
    }

    for attempt in range(1, max_attempts + 1):
        logger.info("Creative derivation attempt %s input=%s", attempt, input_summary)
        try:
            raw_output = client.generate_derivation_json(
                spec,
                context,
                previous_error=previous_error,
            )
            last_raw_output = raw_output
            logger.info("Creative derivation attempt %s raw_output=%s", attempt, raw_output)

            parsed_json = parse_json_object(raw_output)
            logger.info(
                "Creative derivation attempt %s parsed_json=%s",
                attempt,
                json.dumps(parsed_json, ensure_ascii=False),
            )
            drafts = MarketCreativeDraftSet.model_validate(parsed_json)
            creatives = _finalize_market_creatives(drafts.creatives, spec, context)
            logger.info(
                "Creative derivation attempt %s validation=success result=%s",
                attempt,
                creatives.model_dump_json(),
            )
            return DerivationResult(
                creatives=creatives,
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

    raise CreativeDerivationError(
        f"生成多市场创意失败：已重试 {max_attempts} 次，仍未得到合规 JSON。",
        attempt_errors=attempt_errors,
        last_raw_output=last_raw_output,
    )


def _finalize_market_creatives(
    drafts: list[MarketCreativeDraft],
    spec: ProductSpec,
    context: DerivationContext,
) -> MarketCreativeSet:
    draft_by_market = {draft.market: draft for draft in drafts}
    if len(draft_by_market) != len(drafts):
        raise ValueError("每个市场只能生成一套创意")
    expected_markets = set(context.target_markets)
    actual_markets = set(draft_by_market)
    if actual_markets != expected_markets:
        missing = sorted(expected_markets - actual_markets)
        unexpected = sorted(actual_markets - expected_markets)
        raise ValueError(f"市场覆盖不一致：缺少={missing}，额外={unexpected}")

    anchor_block = build_anchor_block(spec)
    return MarketCreativeSet(
        creatives=[
            MarketCreative(
                **draft_by_market[market].model_dump(
                    exclude={"image_prompt_draft", "video_prompt_draft"}
                ),
                image_prompt=_build_prompt_artifact(
                    anchor_block,
                    draft_by_market[market].image_prompt_draft,
                ),
                video_prompt=_build_prompt_artifact(
                    anchor_block,
                    draft_by_market[market].video_prompt_draft,
                ),
            )
            for market in context.target_markets
        ]
    )


def _build_prompt_artifact(anchor_block: str, creative_direction: str) -> PromptArtifact:
    bare_prompt = (
        "[MARKET CREATIVE DIRECTION - no product anchor]\n"
        f"{creative_direction.strip()}"
    )
    return PromptArtifact(
        prompt=(
            f"{anchor_block}\n\n"
            f"{bare_prompt}"
        ),
        bare_prompt=bare_prompt,
        anchor_block=anchor_block,
        referenced_spec_fields=ANCHOR_REFERENCE_FIELDS,
    )
