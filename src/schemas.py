from __future__ import annotations

import re
from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator


HEX_COLOR_RE = re.compile(r"^#[0-9A-Fa-f]{6}$")
UNKNOWN = "未知"
SUPPORTED_MARKETS = {"美国", "欧洲", "日本", "韩国", "东南亚"}


def _clean_text(value: Any) -> str:
    if value is None:
        return ""
    return str(value).strip()


class StrictBaseModel(BaseModel):
    model_config = ConfigDict(extra="forbid")


class BriefImage(StrictBaseModel):
    file_name: str
    mime_type: str
    data: bytes = Field(repr=False)

    @field_validator("file_name", "mime_type", mode="before")
    @classmethod
    def validate_non_empty_text(cls, value: Any) -> str:
        cleaned = _clean_text(value)
        if not cleaned:
            raise ValueError("不能为空")
        return cleaned

    @field_validator("mime_type")
    @classmethod
    def validate_image_mime_type(cls, value: str) -> str:
        if not value.startswith("image/"):
            raise ValueError("只支持图片文件")
        return value

    @field_validator("data")
    @classmethod
    def validate_data(cls, value: bytes) -> bytes:
        if not value:
            raise ValueError("图片文件不能为空")
        return value


class Brief(StrictBaseModel):
    name: str
    selling_points: str
    brand_tone: str
    target_markets: list[str] = Field(min_length=1)
    platform: str
    style_preference: str
    material_hint: str = ""
    images: list[BriefImage] = Field(min_length=1, max_length=3)

    @field_validator("name", "platform", "style_preference", mode="before")
    @classmethod
    def validate_required_text(cls, value: Any) -> str:
        cleaned = _clean_text(value)
        if not cleaned:
            raise ValueError("不能为空")
        return cleaned

    @field_validator("selling_points", "brand_tone", mode="before")
    @classmethod
    def normalize_optional_text(cls, value: Any) -> str:
        cleaned = _clean_text(value)
        return cleaned or UNKNOWN

    @field_validator("material_hint", mode="before")
    @classmethod
    def normalize_material_hint(cls, value: Any) -> str:
        return _clean_text(value)

    @field_validator("target_markets")
    @classmethod
    def validate_target_markets(cls, value: list[str]) -> list[str]:
        invalid = [item for item in value if item not in SUPPORTED_MARKETS]
        if invalid:
            raise ValueError(f"不支持的目标市场: {invalid}")
        return value


class ProductIdentity(StrictBaseModel):
    name: str
    category: str
    one_line: str

    @field_validator("*", mode="before")
    @classmethod
    def validate_text(cls, value: Any) -> str:
        cleaned = _clean_text(value)
        if not cleaned:
            raise ValueError("不能为空")
        return cleaned


class ColorSpec(StrictBaseModel):
    name: str
    hex: str

    @field_validator("name", mode="before")
    @classmethod
    def validate_name(cls, value: Any) -> str:
        cleaned = _clean_text(value)
        if not cleaned:
            raise ValueError("不能为空")
        return cleaned

    @field_validator("hex", mode="before")
    @classmethod
    def validate_hex(cls, value: Any) -> str:
        cleaned = _clean_text(value)
        if cleaned == UNKNOWN:
            return cleaned
        if not HEX_COLOR_RE.match(cleaned):
            raise ValueError("色值必须是 #RRGGBB 或 未知")
        return cleaned.upper()


class BrandMarkingSpec(StrictBaseModel):
    """The visible brand treatment on the product, not just a generic logo."""

    mark_type: Literal["none", "wordmark", "graphic_mark", "combined_mark", "unreadable"]
    text_content: str
    graphic_description: str
    position: str
    application_method: str
    appearance: str
    preservation_level: Literal["required", "best_effort", "omit_if_unclear"]

    @field_validator(
        "text_content",
        "graphic_description",
        "position",
        "application_method",
        "appearance",
        mode="before",
    )
    @classmethod
    def validate_text(cls, value: Any) -> str:
        cleaned = _clean_text(value)
        if not cleaned:
            raise ValueError("不能为空")
        return cleaned

    @model_validator(mode="after")
    def validate_marking_fields(self) -> "BrandMarkingSpec":
        if self.mark_type == "none":
            fields = (
                self.text_content,
                self.graphic_description,
                self.position,
                self.application_method,
                self.appearance,
            )
            if any(value != "无" for value in fields):
                raise ValueError("mark_type 为 none 时，其余品牌标识字段均需填“无”")
        elif self.mark_type == "wordmark":
            if self.text_content in {"无", UNKNOWN}:
                raise ValueError("文字品牌标识必须填写图片中可读的文字")
            if self.graphic_description != "无":
                raise ValueError("文字品牌标识的 graphic_description 应填“无”")
        elif self.mark_type == "graphic_mark":
            if self.text_content != "无":
                raise ValueError("图形标识的 text_content 应填“无”")
            if self.graphic_description in {"无", UNKNOWN}:
                raise ValueError("图形标识必须描述具体图案内容")
        elif self.mark_type == "combined_mark":
            if self.text_content in {"无", UNKNOWN} or self.graphic_description in {"无", UNKNOWN}:
                raise ValueError("图文组合标识必须同时填写可读文字和图形描述")
        elif self.mark_type == "unreadable":
            if self.text_content != UNKNOWN:
                raise ValueError("不可读标识的 text_content 必须填“未知”")
        return self


class VisualAnchor(StrictBaseModel):
    primary_color: ColorSpec
    secondary_colors: list[ColorSpec] = Field(max_length=6)
    material: str
    silhouette: str
    brand_marking: BrandMarkingSpec
    distinctive_details: list[str] = Field(max_length=8)
    proportions: str

    @field_validator("material", "silhouette", "proportions", mode="before")
    @classmethod
    def validate_text(cls, value: Any) -> str:
        cleaned = _clean_text(value)
        if not cleaned:
            raise ValueError("不能为空")
        return cleaned

    @field_validator("distinctive_details", mode="before")
    @classmethod
    def clean_details(cls, value: Any) -> list[str]:
        if not isinstance(value, list):
            raise ValueError("必须是列表")
        return [_clean_text(item) for item in value if _clean_text(item)]

    @model_validator(mode="before")
    @classmethod
    def migrate_legacy_logo(cls, value: Any) -> Any:
        if not isinstance(value, dict) or "brand_marking" in value:
            return value
        legacy_logo = value.get("logo")
        if not isinstance(legacy_logo, dict):
            return value

        text = _clean_text(legacy_logo.get("text")) or UNKNOWN
        position = _clean_text(legacy_logo.get("position")) or UNKNOWN
        style = _clean_text(legacy_logo.get("style")) or UNKNOWN
        if text == "无":
            marking = {
                "mark_type": "none",
                "text_content": "无",
                "graphic_description": "无",
                "position": "无",
                "application_method": "无",
                "appearance": "无",
                "preservation_level": "omit_if_unclear",
            }
        elif text == "图形":
            marking = {
                "mark_type": "graphic_mark",
                "text_content": "无",
                "graphic_description": style if style != UNKNOWN else "未知图形内容",
                "position": position,
                "application_method": "未知",
                "appearance": "未知",
                "preservation_level": "best_effort",
            }
        else:
            marking = {
                "mark_type": "wordmark",
                "text_content": text,
                "graphic_description": "无",
                "position": position,
                "application_method": "未知",
                "appearance": style,
                "preservation_level": "best_effort",
            }
        migrated = dict(value)
        migrated.pop("logo", None)
        migrated["brand_marking"] = marking
        return migrated


class SellingPoint(StrictBaseModel):
    point: str
    priority: int = Field(ge=1, le=4)

    @field_validator("point", mode="before")
    @classmethod
    def validate_point(cls, value: Any) -> str:
        cleaned = _clean_text(value)
        if not cleaned:
            raise ValueError("不能为空")
        if len(cleaned) > 20:
            raise ValueError("卖点需控制在 20 字以内")
        return cleaned


class ProductSpec(StrictBaseModel):
    product_identity: ProductIdentity
    visual_anchor: VisualAnchor
    selling_points: list[SellingPoint] = Field(min_length=1, max_length=4)
    brand_tone: list[str] = Field(max_length=5)
    visual_taboos: list[str] = Field(max_length=6)
    anchor_sentence: str

    @field_validator("brand_tone", mode="before")
    @classmethod
    def clean_brand_tone(cls, value: Any) -> list[str]:
        if not isinstance(value, list):
            raise ValueError("必须是列表")
        cleaned = [_clean_text(item) for item in value if _clean_text(item)]
        for item in cleaned:
            if len(item) > 6:
                raise ValueError("品牌调性关键词每个不超过 6 字")
        return cleaned

    @field_validator("visual_taboos", mode="before")
    @classmethod
    def clean_visual_taboos(cls, value: Any) -> list[str]:
        if not isinstance(value, list):
            raise ValueError("必须是列表")
        return [_clean_text(item) for item in value if _clean_text(item)]

    @field_validator("anchor_sentence", mode="before")
    @classmethod
    def validate_anchor_sentence(cls, value: Any) -> str:
        cleaned = _clean_text(value)
        if not cleaned:
            raise ValueError("不能为空")
        if len(cleaned) > 60:
            raise ValueError("anchor_sentence 需控制在 60 字以内")
        return cleaned

    @model_validator(mode="after")
    def validate_selling_priorities(self) -> "ProductSpec":
        priorities = [item.priority for item in self.selling_points]
        if len(priorities) != len(set(priorities)):
            raise ValueError("selling_points priority 不能重复")
        return self


class DerivationContext(StrictBaseModel):
    target_markets: list[str] = Field(min_length=1, max_length=5)
    platform: str
    style_preference: str

    @field_validator("target_markets")
    @classmethod
    def validate_target_markets(cls, value: list[str]) -> list[str]:
        invalid = [item for item in value if item not in SUPPORTED_MARKETS]
        if invalid:
            raise ValueError(f"不支持的目标市场: {invalid}")
        if len(value) != len(set(value)):
            raise ValueError("目标市场不能重复")
        return value

    @field_validator("platform", "style_preference", mode="before")
    @classmethod
    def validate_required_text(cls, value: Any) -> str:
        cleaned = _clean_text(value)
        if not cleaned:
            raise ValueError("不能为空")
        return cleaned


class StoryboardShot(StrictBaseModel):
    sequence: int = Field(ge=1, le=4)
    duration_seconds: int = Field(ge=1, le=10)
    visual: str
    on_screen_copy: str
    on_screen_copy_zh: str
    voiceover: str
    voiceover_zh: str

    @field_validator("visual", "on_screen_copy", "on_screen_copy_zh", "voiceover", "voiceover_zh", mode="before")
    @classmethod
    def validate_text(cls, value: Any) -> str:
        cleaned = _clean_text(value)
        if not cleaned:
            raise ValueError("不能为空；没有文案时请填“无”")
        return cleaned


class CreativeContent(StrictBaseModel):
    market: str
    language: str
    localization_focus: str
    compliance_note: str
    hook: str
    hook_zh: str
    body_copy: str
    body_copy_zh: str
    cta: str
    cta_zh: str
    storyboard: list[StoryboardShot] = Field(min_length=3, max_length=4)

    @field_validator("market", mode="before")
    @classmethod
    def validate_market(cls, value: Any) -> str:
        cleaned = _clean_text(value)
        if cleaned not in SUPPORTED_MARKETS:
            raise ValueError(f"不支持的目标市场: {cleaned}")
        return cleaned

    @field_validator(
        "language",
        "localization_focus",
        "compliance_note",
        "hook",
        "hook_zh",
        "body_copy",
        "body_copy_zh",
        "cta",
        "cta_zh",
        mode="before",
    )
    @classmethod
    def validate_text(cls, value: Any) -> str:
        cleaned = _clean_text(value)
        if not cleaned:
            raise ValueError("不能为空")
        return cleaned

    @model_validator(mode="after")
    def validate_storyboard(self) -> "CreativeContent":
        sequences = [shot.sequence for shot in self.storyboard]
        if sequences != list(range(1, len(self.storyboard) + 1)):
            raise ValueError("storyboard sequence 必须从 1 连续编号")
        if sum(shot.duration_seconds for shot in self.storyboard) != 15:
            raise ValueError("15 秒分镜的总时长必须恰好为 15 秒")
        return self


class MarketCreativeDraft(CreativeContent):
    image_prompt_draft: str
    video_prompt_draft: str

    @field_validator("image_prompt_draft", "video_prompt_draft", mode="before")
    @classmethod
    def validate_prompt(cls, value: Any) -> str:
        cleaned = _clean_text(value)
        if not cleaned:
            raise ValueError("不能为空")
        return cleaned


class MarketCreativeDraftSet(StrictBaseModel):
    creatives: list[MarketCreativeDraft] = Field(min_length=1, max_length=5)


class PromptArtifact(StrictBaseModel):
    prompt: str
    bare_prompt: str
    anchor_block: str
    referenced_spec_fields: list[str] = Field(min_length=1)

    @field_validator("prompt", "bare_prompt", "anchor_block", mode="before")
    @classmethod
    def validate_text(cls, value: Any) -> str:
        cleaned = _clean_text(value)
        if not cleaned:
            raise ValueError("不能为空")
        return cleaned

    @field_validator("referenced_spec_fields", mode="before")
    @classmethod
    def validate_field_references(cls, value: Any) -> list[str]:
        if not isinstance(value, list):
            raise ValueError("必须是列表")
        cleaned = [_clean_text(item) for item in value if _clean_text(item)]
        if not cleaned:
            raise ValueError("至少标注一个引用字段")
        return list(dict.fromkeys(cleaned))


class MarketCreative(CreativeContent):
    image_prompt: PromptArtifact
    video_prompt: PromptArtifact


class MarketCreativeSet(StrictBaseModel):
    creatives: list[MarketCreative] = Field(min_length=1, max_length=5)


class ABGenerationSettings(StrictBaseModel):
    model: str
    size: Literal["1024x1024", "1024x1536", "1536x1024"] = "1024x1024"
    quality: Literal["low", "medium", "high"] = "medium"
    # 每臂样本数。2 用于扩样本实验（每臂 n=12 时 Mann-Whitney 才有意义）；
    # 暂不开放 3+，样本翻倍即成本翻倍，且现阶段没有需要它的实验设计。
    samples_per_arm: Literal[1, 2] = 1

    @field_validator("model", mode="before")
    @classmethod
    def validate_model(cls, value: Any) -> str:
        cleaned = _clean_text(value)
        if not cleaned:
            raise ValueError("图像模型不能为空")
        return cleaned


class JudgeDimension(StrictBaseModel):
    score: int = Field(ge=0, le=5)
    reason: str

    @field_validator("reason", mode="before")
    @classmethod
    def validate_reason(cls, value: Any) -> str:
        cleaned = _clean_text(value)
        if not cleaned:
            raise ValueError("评分理由不能为空")
        return cleaned


class ProductIdentityScores(StrictBaseModel):
    color: JudgeDimension
    brand_marking: JudgeDimension
    material: JudgeDimension
    silhouette: JudgeDimension
    distinctive_details: JudgeDimension

    @model_validator(mode="before")
    @classmethod
    def migrate_legacy_logo_score(cls, value: Any) -> Any:
        if isinstance(value, dict) and "brand_marking" not in value and "logo" in value:
            migrated = dict(value)
            migrated["brand_marking"] = migrated.pop("logo")
            return migrated
        return value


class BlindCandidateScore(StrictBaseModel):
    candidate_id: Literal["X", "Y"]
    dimensions: ProductIdentityScores


class BlindJudgeResponse(StrictBaseModel):
    candidates: list[BlindCandidateScore] = Field(min_length=2, max_length=2)

    @model_validator(mode="after")
    def validate_candidate_ids(self) -> "BlindJudgeResponse":
        if {item.candidate_id for item in self.candidates} != {"X", "Y"}:
            raise ValueError("裁判结果必须恰好包含 Candidate X 和 Candidate Y")
        return self
