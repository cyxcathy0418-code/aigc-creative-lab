from __future__ import annotations

import base64
import hashlib
import io
import json
import logging
import random
import time
import zipfile
from abc import ABC, abstractmethod
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from openai import OpenAI

from src.config import PROJECT_ROOT, Settings, get_settings
from src.schemas import ABGenerationSettings, MarketCreative, ProductSpec


logger = logging.getLogger("creative_lab.ab_experiment")
ARTIFACTS_ROOT = PROJECT_ROOT / "artifacts" / "ab_experiments"
IGNORED_LEAK_VALUES = {"", "无", "未知", "图形", "未知图形内容"}


class BaseImageGenerator(ABC):
    @abstractmethod
    def generate(self, prompt: str, settings: ABGenerationSettings) -> tuple[bytes, str]:
        """Return generated image bytes and MIME type."""


class OpenAIImageGenerator(BaseImageGenerator):
    def __init__(self, settings: Settings | None = None) -> None:
        self.settings = settings or get_settings()
        if not self.settings.openai_api_key:
            raise RuntimeError("未检测到 OPENAI_API_KEY，请确认 .env 已配置。")
        self.client = OpenAI(
            api_key=self.settings.openai_api_key,
            timeout=self.settings.request_timeout,
        )

    def generate(self, prompt: str, settings: ABGenerationSettings) -> tuple[bytes, str]:
        response = self.client.images.generate(
            model=settings.model,
            prompt=prompt,
            size=settings.size,
            quality=settings.quality,
        )
        if not response.data or not response.data[0].b64_json:
            raise ValueError("图像 API 未返回可用的 base64 图片。")
        return base64.b64decode(response.data[0].b64_json), "image/png"


def build_control_prompt(spec: ProductSpec, creative: MarketCreative) -> str:
    """Create a useful baseline while excluding structured visual identity fields."""
    direction = creative.image_prompt.bare_prompt.strip()
    prompt = "\n".join(
        [
            "[BASELINE PRODUCT CONTEXT - no structured visual anchor]",
            f"Product: {spec.product_identity.name} ({spec.product_identity.category})",
            direction,
        ]
    )
    leaks = find_anchor_leaks(prompt, spec)
    if leaks:
        raise ValueError(
            "Control Prompt 检测到商品视觉锚点泄漏：" + "、".join(leaks)
        )
    return prompt


def find_anchor_leaks(prompt: str, spec: ProductSpec) -> list[str]:
    visual = spec.visual_anchor
    marking = visual.brand_marking
    protected_mark_text = (
        []
        if marking.text_content.casefold() == spec.product_identity.name.strip().casefold()
        else [marking.text_content]
    )
    candidates = [
        visual.primary_color.name,
        visual.primary_color.hex,
        *(color.name for color in visual.secondary_colors),
        *(color.hex for color in visual.secondary_colors),
        visual.material,
        visual.silhouette,
        *protected_mark_text,
        marking.graphic_description,
        marking.position,
        marking.application_method,
        marking.appearance,
        *visual.distinctive_details,
        visual.proportions,
        spec.anchor_sentence,
        *spec.visual_taboos,
    ]
    prompt_folded = prompt.casefold()
    leaks: list[str] = []
    for raw_value in candidates:
        value = str(raw_value).strip()
        if value in IGNORED_LEAK_VALUES or len(value) < 3:
            continue
        if value.casefold() in prompt_folded:
            leaks.append(value)
    return list(dict.fromkeys(leaks))


def build_prompt_pairs(
    spec: ProductSpec,
    creatives_data: list[dict[str, Any]],
    selected_markets: list[str],
) -> dict[str, dict[str, str]]:
    creative_by_market = {
        item.market: item
        for item in (MarketCreative.model_validate(raw) for raw in creatives_data)
    }
    missing = [market for market in selected_markets if market not in creative_by_market]
    if missing:
        raise ValueError(f"缺少以下市场的创意 Prompt：{missing}")

    return {
        market: {
            "A": build_control_prompt(spec, creative_by_market[market]),
            "B": creative_by_market[market].image_prompt.prompt,
        }
        for market in selected_markets
    }


def build_experiment_fingerprint(
    spec: ProductSpec,
    prompt_pairs: dict[str, dict[str, str]],
    selected_markets: list[str],
    source_images: list[dict[str, Any]],
    primary_reference_index: int,
    generation_settings: ABGenerationSettings,
) -> str:
    payload = {
        "spec": spec.model_dump(),
        "prompt_pairs": prompt_pairs,
        "selected_markets": selected_markets,
        "source_images": [
            {
                "file_name": image["file_name"],
                "mime_type": image["mime_type"],
                "sha256": image.get("sha256") or _sha256(image["data"]),
            }
            for image in source_images
        ],
        "primary_reference_index": primary_reference_index,
        "generation_settings": generation_settings.model_dump(),
    }
    canonical = json.dumps(payload, ensure_ascii=False, sort_keys=True, separators=(",", ":"))
    return hashlib.sha256(canonical.encode("utf-8")).hexdigest()


def run_ab_images(
    spec: ProductSpec,
    creatives_data: list[dict[str, Any]],
    selected_markets: list[str],
    source_images: list[dict[str, Any]],
    primary_reference_index: int,
    generation_settings: ABGenerationSettings,
    generator: BaseImageGenerator | None = None,
) -> dict[str, Any]:
    if len(selected_markets) < 2:
        raise ValueError("跨市场 A/B 实验至少需要选择 2 个市场。")
    if not source_images:
        raise ValueError("缺少真实商品参考图，请重新生成 Spec。")
    if primary_reference_index < 0 or primary_reference_index >= len(source_images):
        raise ValueError("主参考图索引无效。")

    prompt_pairs = build_prompt_pairs(spec, creatives_data, selected_markets)
    fingerprint = build_experiment_fingerprint(
        spec,
        prompt_pairs,
        selected_markets,
        source_images,
        primary_reference_index,
        generation_settings,
    )
    experiment_id = fingerprint[:16]
    experiment_dir = ARTIFACTS_ROOT / experiment_id
    manifest_path = experiment_dir / "manifest.json"
    experiment_dir.mkdir(parents=True, exist_ok=True)
    (experiment_dir / "generated").mkdir(exist_ok=True)
    (experiment_dir / "references").mkdir(exist_ok=True)

    manifest = _load_json(manifest_path) or _new_manifest(
        experiment_id=experiment_id,
        fingerprint=fingerprint,
        spec=spec,
        selected_markets=selected_markets,
        source_images=source_images,
        primary_reference_index=primary_reference_index,
        generation_settings=generation_settings,
        prompt_pairs=prompt_pairs,
    )
    _persist_reference_images(experiment_dir, source_images, manifest)
    manifest["generation_errors"] = []
    manifest["status"] = "generating"
    _write_manifest(manifest_path, manifest)

    generator = generator or OpenAIImageGenerator()
    tasks = [(market, arm) for market in selected_markets for arm in ("A", "B")]
    random.Random(fingerprint).shuffle(tasks)
    manifest["generation_order"] = [f"{market}:{arm}" for market, arm in tasks]

    for market, arm in tasks:
        existing = manifest.get("images", {}).get(market, {}).get(arm)
        if existing and (experiment_dir / existing["relative_path"]).exists():
            logger.info("A/B image cache hit experiment=%s market=%s arm=%s", experiment_id, market, arm)
            continue

        prompt = prompt_pairs[market][arm]
        try:
            image_bytes, mime_type, attempts = _generate_with_retries(
                generator,
                prompt,
                generation_settings,
            )
            relative_path = Path("generated") / f"{market}_arm_{arm}.png"
            output_path = experiment_dir / relative_path
            output_path.write_bytes(image_bytes)
            manifest.setdefault("images", {}).setdefault(market, {})[arm] = {
                "relative_path": relative_path.as_posix(),
                "mime_type": mime_type,
                "sha256": _sha256(image_bytes),
                "size_bytes": len(image_bytes),
                "attempts": attempts,
            }
            logger.info(
                "A/B image parsed experiment=%s market=%s arm=%s bytes=%s sha256=%s",
                experiment_id,
                market,
                arm,
                len(image_bytes),
                _sha256(image_bytes),
            )
        except Exception as exc:
            logger.exception("A/B image failed experiment=%s market=%s arm=%s", experiment_id, market, arm)
            manifest["generation_errors"].append(
                {"market": market, "arm": arm, "error": str(exc)}
            )
        manifest["updated_at"] = _utc_now()
        _write_manifest(manifest_path, manifest)

    expected_count = len(selected_markets) * 2
    actual_count = sum(len(arms) for arms in manifest.get("images", {}).values())
    manifest["status"] = "generated" if actual_count == expected_count else "generation_partial"
    manifest["updated_at"] = _utc_now()
    _write_manifest(manifest_path, manifest)
    return manifest


def get_experiment_dir(manifest: dict[str, Any]) -> Path:
    return ARTIFACTS_ROOT / manifest["experiment_id"]


def load_experiment_by_id(experiment_id: str) -> dict[str, Any]:
    """从磁盘按实验 ID 直接读回 manifest，用于跨 session 恢复已跑好的实验（避免因 Spec
    重新生成导致指纹不匹配、被迫重新花钱生成图片）。"""
    experiment_id = experiment_id.strip()
    manifest_path = ARTIFACTS_ROOT / experiment_id / "manifest.json"
    if not manifest_path.exists():
        raise FileNotFoundError(f"未找到实验 {experiment_id}（路径不存在：{manifest_path}）")
    return _load_json(manifest_path)  # type: ignore[return-value]


def list_experiment_ids() -> list[str]:
    if not ARTIFACTS_ROOT.exists():
        return []
    return sorted(
        p.name for p in ARTIFACTS_ROOT.iterdir()
        if p.is_dir() and (p / "manifest.json").exists()
    )


def save_manual_scores(manifest: dict[str, Any], manual_scores: dict[str, Any]) -> dict[str, Any]:
    manifest["manual_scores"] = manual_scores
    manifest["updated_at"] = _utc_now()
    _write_manifest(get_experiment_dir(manifest) / "manifest.json", manifest)
    return manifest


def save_experiment_manifest(manifest: dict[str, Any]) -> dict[str, Any]:
    manifest["updated_at"] = _utc_now()
    _write_manifest(get_experiment_dir(manifest) / "manifest.json", manifest)
    return manifest


def build_experiment_zip(manifest: dict[str, Any]) -> bytes:
    experiment_dir = get_experiment_dir(manifest)
    buffer = io.BytesIO()
    with zipfile.ZipFile(buffer, "w", compression=zipfile.ZIP_DEFLATED) as archive:
        for path in sorted(experiment_dir.rglob("*")):
            if path.is_file() and path.suffix.lower() != ".zip":
                archive.write(path, path.relative_to(experiment_dir).as_posix())
    return buffer.getvalue()


def _new_manifest(
    experiment_id: str,
    fingerprint: str,
    spec: ProductSpec,
    selected_markets: list[str],
    source_images: list[dict[str, Any]],
    primary_reference_index: int,
    generation_settings: ABGenerationSettings,
    prompt_pairs: dict[str, dict[str, str]],
) -> dict[str, Any]:
    now = _utc_now()
    return {
        "schema_version": 1,
        "experiment_id": experiment_id,
        "fingerprint": fingerprint,
        "created_at": now,
        "updated_at": now,
        "status": "created",
        "spec": spec.model_dump(),
        "selected_markets": selected_markets,
        "primary_reference_index": primary_reference_index,
        "generation_settings": generation_settings.model_dump(),
        "prompt_pairs": prompt_pairs,
        "source_images": [
            {
                "file_name": image["file_name"],
                "mime_type": image["mime_type"],
                "sha256": image.get("sha256") or _sha256(image["data"]),
            }
            for image in source_images
        ],
        "images": {},
        "generation_errors": [],
        "evaluations": {"fidelity": {}, "consistency": {}},
        "evaluation_errors": [],
        "manual_scores": {},
    }


def _persist_reference_images(
    experiment_dir: Path,
    source_images: list[dict[str, Any]],
    manifest: dict[str, Any],
) -> None:
    for index, (source, metadata) in enumerate(zip(source_images, manifest["source_images"]), start=1):
        suffix = Path(source["file_name"]).suffix.lower() or _suffix_for_mime(source["mime_type"])
        relative_path = Path("references") / f"reference_{index}{suffix}"
        path = experiment_dir / relative_path
        if not path.exists() or _sha256(path.read_bytes()) != metadata["sha256"]:
            path.write_bytes(source["data"])
        metadata["relative_path"] = relative_path.as_posix()
        metadata["size_bytes"] = len(source["data"])


def _generate_with_retries(
    generator: BaseImageGenerator,
    prompt: str,
    generation_settings: ABGenerationSettings,
) -> tuple[bytes, str, int]:
    max_attempts = get_settings().max_retries
    errors: list[str] = []
    prompt_hash = hashlib.sha256(prompt.encode("utf-8")).hexdigest()
    for attempt in range(1, max_attempts + 1):
        logger.info(
            "A/B image call attempt=%s model=%s size=%s quality=%s prompt_sha256=%s prompt=%s",
            attempt,
            generation_settings.model,
            generation_settings.size,
            generation_settings.quality,
            prompt_hash,
            prompt,
        )
        try:
            image_bytes, mime_type = generator.generate(prompt, generation_settings)
            logger.info(
                "A/B image raw response attempt=%s mime_type=%s size_bytes=%s",
                attempt,
                mime_type,
                len(image_bytes),
            )
            return image_bytes, mime_type, attempt
        except Exception as exc:
            errors.append(f"第 {attempt} 次失败: {exc}")
            logger.warning("A/B image attempt failed: %s", exc, exc_info=True)
            if attempt < max_attempts:
                time.sleep(min(2 ** (attempt - 1), 6))
    raise RuntimeError("；".join(errors))


def _write_manifest(path: Path, manifest: dict[str, Any]) -> None:
    temporary = path.with_suffix(".tmp")
    temporary.write_text(
        json.dumps(manifest, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )
    temporary.replace(path)


def _load_json(path: Path) -> dict[str, Any] | None:
    if not path.exists():
        return None
    return json.loads(path.read_text(encoding="utf-8"))


def _sha256(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def _suffix_for_mime(mime_type: str) -> str:
    return {
        "image/jpeg": ".jpg",
        "image/webp": ".webp",
        "image/png": ".png",
    }.get(mime_type, ".img")


def _utc_now() -> str:
    return datetime.now(timezone.utc).isoformat()
