from __future__ import annotations

import base64
import json
import logging
import random
import time
from abc import ABC, abstractmethod
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from openai import OpenAI
from pydantic import ValidationError

from src.ab_experiment import (
    get_experiment_dir,
    migrate_legacy_single_sample,
    samples_per_arm,
    save_experiment_manifest,
)
from src.config import Settings, get_settings
from src.retry import parse_json_object
from src.schemas import BlindJudgeResponse


logger = logging.getLogger("creative_lab.ab_eval")
DIMENSION_KEYS = ("color", "brand_marking", "material", "silhouette", "distinctive_details")


@dataclass
class JudgeCallResult:
    parsed: BlindJudgeResponse
    raw_output: str
    attempts: int


class BaseABJudge(ABC):
    model_name: str = "custom-judge"

    @abstractmethod
    def judge_fidelity(
        self,
        reference_images: list[dict[str, Any]],
        candidates: dict[str, dict[str, Any]],
    ) -> JudgeCallResult:
        """Blindly score Candidate X and Y against the product references."""

    @abstractmethod
    def judge_consistency(
        self,
        candidate_groups: dict[str, list[dict[str, Any]]],
    ) -> JudgeCallResult:
        """Blindly score cross-market consistency for Group X and Y."""


class OpenAIABJudge(BaseABJudge):
    def __init__(self, settings: Settings | None = None) -> None:
        self.settings = settings or get_settings()
        if not self.settings.openai_api_key:
            raise RuntimeError("未检测到 OPENAI_API_KEY，请确认 .env 已配置。")
        self.model_name = self.settings.openai_judge_model
        self.client = OpenAI(
            api_key=self.settings.openai_api_key,
            timeout=self.settings.request_timeout,
        )

    def judge_fidelity(
        self,
        reference_images: list[dict[str, Any]],
        candidates: dict[str, dict[str, Any]],
    ) -> JudgeCallResult:
        content: list[dict[str, Any]] = [
            {
                "type": "input_text",
                "text": _fidelity_prompt(),
            }
        ]
        for index, image in enumerate(reference_images, start=1):
            role = "主参考图" if index == 1 else f"辅助参考图 {index - 1}"
            content.extend(_labeled_image_content(role, image))
        for candidate_id in ("X", "Y"):
            content.extend(
                _labeled_image_content(
                    f"Candidate {candidate_id}",
                    candidates[candidate_id],
                )
            )
        return self._call_with_retries(content, call_name="fidelity")

    def judge_consistency(
        self,
        candidate_groups: dict[str, list[dict[str, Any]]],
    ) -> JudgeCallResult:
        content: list[dict[str, Any]] = [
            {
                "type": "input_text",
                "text": _consistency_prompt(),
            }
        ]
        for candidate_id in ("X", "Y"):
            for index, image in enumerate(candidate_groups[candidate_id], start=1):
                content.extend(
                    _labeled_image_content(
                        f"Group {candidate_id} / Market image {index}",
                        image,
                    )
                )
        return self._call_with_retries(content, call_name="consistency")

    def _call_with_retries(
        self,
        content: list[dict[str, Any]],
        call_name: str,
    ) -> JudgeCallResult:
        max_attempts = self.settings.max_retries
        errors: list[str] = []
        for attempt in range(1, max_attempts + 1):
            logger.info(
                "A/B judge call=%s attempt=%s model=%s image_count=%s",
                call_name,
                attempt,
                self.model_name,
                sum(item.get("type") == "input_image" for item in content),
            )
            try:
                response = self.client.responses.create(
                    model=self.model_name,
                    input=[{"role": "user", "content": content}],
                    max_output_tokens=3200,
                    text={
                        "format": {
                            "type": "json_schema",
                            "name": f"ab_{call_name}_judge",
                            "schema": BlindJudgeResponse.model_json_schema(),
                            "strict": True,
                        }
                    },
                )
                raw_output = _response_to_text(response)
                logger.info("A/B judge call=%s attempt=%s raw_output=%s", call_name, attempt, raw_output)
                parsed_json = parse_json_object(raw_output)
                parsed = BlindJudgeResponse.model_validate(parsed_json)
                logger.info(
                    "A/B judge call=%s attempt=%s parsed=%s",
                    call_name,
                    attempt,
                    parsed.model_dump_json(),
                )
                return JudgeCallResult(parsed=parsed, raw_output=raw_output, attempts=attempt)
            except (ValidationError, ValueError, json.JSONDecodeError) as exc:
                errors.append(f"第 {attempt} 次解析/校验失败: {exc}")
                logger.warning("A/B judge parse failed: %s", exc, exc_info=True)
            except Exception as exc:
                errors.append(f"第 {attempt} 次调用失败: {exc}")
                logger.warning("A/B judge call failed: %s", exc, exc_info=True)
            if attempt < max_attempts:
                time.sleep(min(2 ** (attempt - 1), 6))
        raise RuntimeError("；".join(errors))


def evaluate_ab_experiment(
    manifest: dict[str, Any],
    source_images: list[dict[str, Any]],
    judge: BaseABJudge | None = None,
) -> dict[str, Any]:
    if manifest.get("status") not in {"generated", "evaluation_partial", "complete"}:
        return manifest

    judge = judge or OpenAIABJudge()
    manifest = migrate_legacy_single_sample(manifest)
    manifest["judge_model"] = judge.model_name
    manifest["evaluation_errors"] = []
    evaluations = manifest.setdefault("evaluations", {"fidelity": {}, "consistency": []})
    experiment_dir = get_experiment_dir(manifest)
    reference_images = _ordered_references(source_images, manifest["primary_reference_index"])
    sample_count = samples_per_arm(manifest)

    # 每个样本各跑一次独立盲评（裁判每次仍只看 2 张候选图），产出 sample_count 个
    # 相互独立的数据点。刻意不改成「一次看 2N 张」——那会换掉评分口径，新数据就
    # 无法和既有实验放在同一把尺子上比。
    for market in manifest["selected_markets"]:
        entries = evaluations["fidelity"].setdefault(market, [])
        for sample_index in range(sample_count):
            if _is_scored(_entry_at(entries, sample_index)):
                logger.info(
                    "A/B fidelity cache hit experiment=%s market=%s sample=%s",
                    manifest["experiment_id"],
                    market,
                    sample_index + 1,
                )
                continue
            mapping = blind_mapping(
                f"{manifest['fingerprint']}:fidelity:{market}:{sample_index}"
            )
            try:
                candidates = {
                    candidate_id: _read_generated_image(
                        experiment_dir, manifest, market, arm, sample_index
                    )
                    for candidate_id, arm in mapping.items()
                }
                result = judge.judge_fidelity(reference_images, candidates)
                by_candidate = {item.candidate_id: item for item in result.parsed.candidates}
                market_result: dict[str, Any] = {
                    "sample": sample_index + 1,
                    "blind_mapping": mapping,
                    "raw_output": result.raw_output,
                    "attempts": result.attempts,
                }
                for candidate_id, arm in mapping.items():
                    market_result[arm] = _serialize_score(by_candidate[candidate_id])
                _set_entry(entries, sample_index, market_result)
            except Exception as exc:
                logger.exception(
                    "A/B fidelity evaluation failed market=%s sample=%s", market, sample_index + 1
                )
                manifest["evaluation_errors"].append(
                    {
                        "stage": "fidelity",
                        "market": market,
                        "sample": sample_index + 1,
                        "error": str(exc),
                    }
                )
            save_experiment_manifest(manifest)

    consistency_entries = evaluations.setdefault("consistency", [])
    for sample_index in range(sample_count):
        if _is_scored(_entry_at(consistency_entries, sample_index)):
            logger.info(
                "A/B consistency cache hit experiment=%s sample=%s",
                manifest["experiment_id"],
                sample_index + 1,
            )
            continue
        mapping = blind_mapping(f"{manifest['fingerprint']}:consistency:{sample_index}")
        try:
            groups = {
                candidate_id: [
                    _read_generated_image(experiment_dir, manifest, market, arm, sample_index)
                    for market in manifest["selected_markets"]
                ]
                for candidate_id, arm in mapping.items()
            }
            result = judge.judge_consistency(groups)
            by_candidate = {item.candidate_id: item for item in result.parsed.candidates}
            consistency_result: dict[str, Any] = {
                "sample": sample_index + 1,
                "blind_mapping": mapping,
                "raw_output": result.raw_output,
                "attempts": result.attempts,
            }
            for candidate_id, arm in mapping.items():
                consistency_result[arm] = _serialize_score(by_candidate[candidate_id])
            _set_entry(consistency_entries, sample_index, consistency_result)
        except Exception as exc:
            logger.exception("A/B consistency evaluation failed sample=%s", sample_index + 1)
            manifest["evaluation_errors"].append(
                {"stage": "consistency", "sample": sample_index + 1, "error": str(exc)}
            )
        save_experiment_manifest(manifest)

    complete_fidelity = all(
        _is_scored(_entry_at(evaluations["fidelity"].get(market, []), sample_index))
        for market in manifest["selected_markets"]
        for sample_index in range(sample_count)
    )
    complete_consistency = all(
        _is_scored(_entry_at(consistency_entries, sample_index))
        for sample_index in range(sample_count)
    )
    manifest["status"] = "complete" if complete_fidelity and complete_consistency else "evaluation_partial"
    return save_experiment_manifest(manifest)


def _entry_at(entries: list[Any], sample_index: int) -> dict[str, Any] | None:
    return entries[sample_index] if sample_index < len(entries) else None


def _set_entry(entries: list[Any], sample_index: int, value: dict[str, Any]) -> None:
    while len(entries) <= sample_index:
        entries.append(None)
    entries[sample_index] = value


def _is_scored(entry: dict[str, Any] | None) -> bool:
    return bool(entry) and "A" in entry and "B" in entry


def _serialize_score(candidate: Any) -> dict[str, Any]:
    dimensions = candidate.dimensions.model_dump()
    overall = round(
        sum(dimensions[key]["score"] for key in DIMENSION_KEYS) / len(DIMENSION_KEYS),
        2,
    )
    return {"dimensions": dimensions, "overall": overall}


def blind_mapping(seed: str) -> dict[str, str]:
    """把两臂确定性地打乱成候选 X/Y。同一 seed 永远得到同一映射，实验因此可复现；
    LLM 盲评与人工盲评使用不同 seed 命名空间，两者的映射互相独立。"""
    arms = ["A", "B"]
    random.Random(seed).shuffle(arms)
    return {"X": arms[0], "Y": arms[1]}


def _ordered_references(
    source_images: list[dict[str, Any]],
    primary_index: int,
) -> list[dict[str, Any]]:
    ordered = [source_images[primary_index]]
    ordered.extend(image for index, image in enumerate(source_images) if index != primary_index)
    return ordered


def _read_generated_image(
    experiment_dir: Path,
    manifest: dict[str, Any],
    market: str,
    arm: str,
    sample_index: int,
) -> dict[str, Any]:
    samples = manifest["images"][market][arm]
    metadata = samples[sample_index] if sample_index < len(samples) else None
    if not metadata:
        raise ValueError(f"缺少 {market} / Arm {arm} 第 {sample_index + 1} 张生成图。")
    return {
        "data": (experiment_dir / metadata["relative_path"]).read_bytes(),
        "mime_type": metadata["mime_type"],
    }


def _labeled_image_content(label: str, image: dict[str, Any]) -> list[dict[str, Any]]:
    encoded = base64.b64encode(image["data"]).decode("ascii")
    return [
        {"type": "input_text", "text": label},
        {
            "type": "input_image",
            "image_url": f"data:{image['mime_type']};base64,{encoded}",
        },
    ]


def _fidelity_prompt() -> str:
    return """你是严格的电商商品视觉一致性评估员。以下先给真实商品参考图，再给两个随机编号候选图。
你不知道候选图来自哪种方法，也不得推测。不要评价广告创意、背景、人物、文案、美感或市场适配，只比较商品本体。
分别为 Candidate X 和 Candidate Y 的五个维度打 0-5 分并给出可观察的简短理由：
color 颜色；brand_marking 品牌标识的类型、文字或图形内容、位置及呈现工艺；material 材质与表面质感；silhouette 轮廓和比例；distinctive_details 独特部件。
看不清的维度应保守评分并说明，不要编造。严格按 JSON Schema 输出。"""


def _consistency_prompt() -> str:
    return """你是严格的跨广告版本商品身份一致性评估员。下面有 Group X 和 Group Y，每组包含同一商品在不同市场的多张广告图。
你不知道两组来自哪种方法，也不得推测。市场背景、人物、语言、构图和广告风格本来就应不同，必须忽略这些差异，只比较组内商品本体是否稳定。
分别为 Group X 和 Group Y 的五个维度打 0-5 分并给出可观察的简短理由：
color 颜色；brand_marking 品牌标识的类型、文字或图形内容、位置及呈现工艺；material 材质与表面质感；silhouette 轮廓和比例；distinctive_details 独特部件。
看不清的维度应保守评分并说明，不要编造。输出 candidate_id 时仍使用 X/Y，严格按 JSON Schema 输出。"""


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
