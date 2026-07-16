from __future__ import annotations

import hashlib
import json
from pathlib import Path
from typing import Any

import streamlit as st
from pydantic import ValidationError

from src.ab_eval import blind_mapping
from src.ab_experiment import (
    build_experiment_fingerprint,
    build_experiment_zip,
    build_prompt_pairs,
    get_experiment_dir,
    list_experiment_ids,
    load_experiment_by_id,
    samples_per_arm,
    save_manual_scores,
)
from src.config import configure_langsmith, get_settings
from src.derivation_retry import CreativeDerivationError
from src.graph import build_ab_experiment_graph, build_derivation_graph, build_spec_graph
from src.logging_utils import setup_logging
from src.retry import SpecExtractionError
from src.schemas import ABGenerationSettings, Brief, BriefImage, DerivationContext, ProductSpec


logger = setup_logging()
MAX_IMAGE_SIZE_MB = 10
MAX_IMAGE_SIZE_BYTES = MAX_IMAGE_SIZE_MB * 1024 * 1024
DIMENSION_LABELS = {
    "color": "颜色",
    "brand_marking": "品牌标识",
    "material": "材质",
    "silhouette": "轮廓比例",
    "distinctive_details": "独特部件",
}
# 人工评分表的列名。刻意不用 "Arm A / Arm B"——评分者一旦知道哪列是锚定组，就不是盲评了。
MANUAL_COLUMNS = ("候选 X", "候选 Y")


def _init_page() -> None:
    st.set_page_config(
        page_title="AIGC Creative Lab",
        page_icon="CL",
        layout="wide",
    )
    _apply_theme()
    _render_header()


def _apply_theme() -> None:
    st.markdown(
        """
        <style>
        :root {
            --lab-bg: #f3f2ee;
            --lab-panel: #fbfaf7;
            --lab-ink: #111016;
            --lab-muted: #69656e;
            --lab-line: #d9d5cf;
            --lab-accent: #3d50ff;
            --lab-coral: #ff6a4b;
            --lab-lime: #d6ff55;
            --lab-blue-soft: #e8ebff;
            --lab-accent-soft: #f0f1ff;
        }

        .stApp {
            background: var(--lab-bg);
            color: var(--lab-ink);
        }

        .block-container {
            max-width: 1260px;
            padding-top: 1.15rem;
            padding-bottom: 4.5rem;
        }

        [data-testid="stHeader"] {
            background: rgba(243, 242, 238, 0.84);
            backdrop-filter: blur(12px);
        }

        .lab-nav {
            display: flex;
            align-items: center;
            justify-content: space-between;
            border-bottom: 1px solid var(--lab-ink);
            padding: 0 0 13px;
            margin-bottom: 30px;
        }

        .lab-brand {
            font-size: 14px;
            font-weight: 760;
            letter-spacing: 0.02em;
        }

        .lab-brand-mark {
            display: inline-flex;
            width: 21px;
            height: 21px;
            margin-right: 8px;
            align-items: center;
            justify-content: center;
            background: var(--lab-ink);
            color: var(--lab-lime);
            font-size: 12px;
            vertical-align: -1px;
        }

        .lab-nav-status {
            color: var(--lab-muted);
            font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
            font-size: 11px;
            letter-spacing: 0.07em;
            text-transform: uppercase;
        }

        .lab-hero {
            position: relative;
            display: grid;
            grid-template-columns: minmax(0, 1.06fr) minmax(320px, 0.94fr);
            gap: 36px;
            min-height: 350px;
            padding: 0 0 38px;
            margin-bottom: 33px;
            overflow: hidden;
            border-bottom: 1px solid var(--lab-ink);
        }

        .lab-kicker {
            color: var(--lab-coral);
            font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
            font-size: 11px;
            font-weight: 750;
            letter-spacing: 0.08em;
            text-transform: uppercase;
            margin: 4px 0 18px;
        }

        .lab-title {
            color: var(--lab-ink);
            max-width: 600px;
            font-size: clamp(44px, 5.1vw, 72px);
            line-height: 0.96;
            font-weight: 820;
            margin: 0 0 20px;
            letter-spacing: 0;
        }

        .lab-title-emphasis {
            color: var(--lab-accent);
        }

        .lab-subtitle {
            color: var(--lab-muted);
            font-size: 15px;
            line-height: 1.72;
            max-width: 515px;
            margin: 0;
        }

        .lab-step-row {
            display: flex;
            flex-wrap: wrap;
            gap: 0;
            margin-top: 28px;
        }

        .lab-step {
            border: 1px solid var(--lab-ink);
            border-right: 0;
            color: var(--lab-muted);
            font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
            font-size: 10px;
            letter-spacing: 0.02em;
            padding: 9px 12px;
        }

        .lab-step:last-child {
            border-right: 1px solid var(--lab-ink);
        }

        .lab-step.active {
            background: var(--lab-ink);
            color: var(--lab-lime);
            font-weight: 750;
        }

        .lab-visual-stage {
            position: relative;
            min-height: 325px;
            overflow: hidden;
            background: var(--lab-ink);
        }

        .stage-grid {
            position: absolute;
            inset: 0;
            opacity: 0.36;
            background-image: linear-gradient(rgba(255,255,255,.16) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,.16) 1px, transparent 1px);
            background-size: 28px 28px;
        }

        .stage-blue-block {
            position: absolute;
            top: 30px;
            right: 34px;
            width: 238px;
            height: 164px;
            background: var(--lab-accent);
            animation: stage-drift 7s ease-in-out infinite;
        }

        .stage-coral-block {
            position: absolute;
            right: 0;
            bottom: 0;
            width: 48%;
            height: 92px;
            background: var(--lab-coral);
            animation: stage-slide 8s cubic-bezier(.65,0,.35,1) infinite;
        }

        .stage-lime-rule {
            position: absolute;
            top: 70px;
            left: 0;
            width: 55%;
            height: 10px;
            background: var(--lab-lime);
            animation: stage-pulse 3s ease-in-out infinite;
        }

        .stage-disc {
            position: absolute;
            right: 86px;
            bottom: 42px;
            width: 142px;
            height: 142px;
            border: 1px solid #f8f7f2;
            border-radius: 50%;
            animation: stage-rotate 14s linear infinite;
        }

        .stage-disc::after {
            content: "";
            position: absolute;
            top: 50%;
            left: -18px;
            width: 36px;
            height: 1px;
            background: var(--lab-lime);
        }

        .stage-copy {
            position: absolute;
            z-index: 2;
            left: 23px;
            bottom: 23px;
            color: #f8f7f2;
            font-size: clamp(38px, 4.2vw, 58px);
            font-weight: 820;
            line-height: 0.84;
            letter-spacing: 0;
        }

        .stage-meta {
            position: absolute;
            z-index: 2;
            top: 18px;
            left: 20px;
            color: #f8f7f2;
            font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
            font-size: 10px;
            letter-spacing: .08em;
            text-transform: uppercase;
        }

        .stage-meta span {
            color: var(--lab-lime);
        }

        @keyframes stage-drift {
            0%, 100% { transform: translate(0, 0) rotate(0deg); }
            50% { transform: translate(-20px, 12px) rotate(-4deg); }
        }

        @keyframes stage-slide {
            0%, 100% { transform: translateX(0); }
            50% { transform: translateX(-32px); }
        }

        @keyframes stage-pulse {
            0%, 100% { transform: scaleX(1); transform-origin: left; }
            50% { transform: scaleX(.66); transform-origin: left; }
        }

        @keyframes stage-rotate {
            to { transform: rotate(360deg); }
        }

        .lab-panel-title {
            color: var(--lab-ink);
            font-size: 20px;
            font-weight: 800;
            margin: 0 0 4px;
        }

        .lab-panel-copy {
            color: var(--lab-muted);
            font-size: 13px;
            line-height: 1.65;
            margin: 0 0 16px 0;
        }

        .lab-note {
            border-left: 3px solid var(--lab-coral);
            background: #ebe9e3;
            color: #48434b;
            font-size: 13px;
            line-height: 1.6;
            padding: 12px 13px;
            margin-top: 12px;
        }

        .lab-result-head {
            border-top: 1px solid var(--lab-ink);
            border-bottom: 1px solid var(--lab-ink);
            padding: 22px 0;
            margin: 42px 0 16px;
        }

        div[data-testid="stVerticalBlockBorderWrapper"] {
            border-color: var(--lab-ink);
            border-radius: 0;
            background: var(--lab-panel);
        }

        div[data-testid="stVerticalBlockBorderWrapper"] > div {
            padding: 22px;
        }

        [data-testid="stFileUploader"] {
            margin-top: 2px;
        }

        [data-testid="stFileUploader"] section {
            min-height: 164px;
            border: 1px dashed #9a949f;
            border-radius: 0;
            background: #f8f7f3;
        }

        [data-testid="stFileUploader"] section:hover {
            border-color: var(--lab-accent);
            background: var(--lab-accent-soft);
        }

        label[data-testid="stWidgetLabel"] p {
            color: var(--lab-ink);
            font-size: 13px;
            font-weight: 720;
        }

        .stTextInput input,
        .stTextArea textarea,
        [data-baseweb="select"] > div,
        [data-baseweb="input"] > div {
            border-radius: 0 !important;
            border-color: #bcb6b0 !important;
            background: #fffefa !important;
        }

        .stTextInput input:focus,
        .stTextArea textarea:focus {
            border-color: var(--lab-accent) !important;
            box-shadow: 0 0 0 1px var(--lab-accent) !important;
        }

        .stButton > button,
        .stDownloadButton > button {
            border-radius: 0;
            min-height: 42px;
            font-weight: 760;
            transition: transform .18s ease, background .18s ease, color .18s ease;
        }

        .stButton > button:hover,
        .stDownloadButton > button:hover {
            transform: translateY(-2px);
        }

        .stButton > button[kind="primary"],
        .stDownloadButton > button[kind="primary"] {
            background: var(--lab-accent);
            border-color: var(--lab-accent);
            color: #fff;
        }

        .stButton > button[kind="primary"]:hover,
        .stDownloadButton > button[kind="primary"]:hover {
            background: var(--lab-ink);
            border-color: var(--lab-ink);
            color: var(--lab-lime);
        }

        .stTabs [data-baseweb="tab-list"] {
            gap: 0;
            border-bottom: 1px solid var(--lab-ink);
        }

        .stTabs [data-baseweb="tab"] {
            height: 42px;
            padding: 0 16px;
            border-right: 1px solid var(--lab-line);
            color: var(--lab-muted);
            font-size: 13px;
        }

        .stTabs [aria-selected="true"] {
            color: var(--lab-ink) !important;
            font-weight: 760;
        }

        .stTabs [data-baseweb="tab-highlight"] {
            background-color: var(--lab-coral) !important;
        }

        .lab-section-title {
            display: flex;
            align-items: baseline;
            gap: 12px;
            margin: 0 0 16px;
        }

        .lab-section-title h2 {
            margin: 0 !important;
            color: var(--lab-ink) !important;
            font-size: 28px !important;
            font-weight: 820 !important;
            line-height: 1.15 !important;
        }

        .lab-section-number {
            color: var(--lab-coral);
            font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
            font-size: 11px;
            font-weight: 750;
        }

        [data-testid="stAlert"] {
            border-radius: 0;
        }

        @media (max-width: 760px) {
            .block-container { padding-top: .7rem; }
            .lab-nav-status { display: none; }
            .lab-hero { grid-template-columns: 1fr; gap: 24px; min-height: auto; }
            .lab-title { font-size: 48px; }
            .lab-visual-stage { min-height: 270px; }
            .lab-step { font-size: 9px; padding: 8px 9px; }
        }

        @media (prefers-reduced-motion: reduce) {
            .stage-blue-block, .stage-coral-block, .stage-lime-rule, .stage-disc { animation: none; }
            .stButton > button, .stDownloadButton > button { transition: none; }
        }
        </style>
        """,
        unsafe_allow_html=True,
    )


def _render_header() -> None:
    st.markdown(
        """
        <nav class="lab-nav">
            <div class="lab-brand"><span class="lab-brand-mark">A</span>AIGC Creative Lab</div>
            <div class="lab-nav-status">Creative intelligence / v0.2</div>
        </nav>
        <section class="lab-hero">
            <div>
                <div class="lab-kicker">01 / Creative Direction</div>
                <h1 class="lab-title">Build the <span class="lab-title-emphasis">signal</span><br>before the ad.</h1>
                <p class="lab-subtitle">
                    把商品图与 Brief 转成清晰、可编辑的 Visual Anchor Spec，先锁住商品身份，再开始广告创意。
                </p>
                <div class="lab-step-row">
                    <span class="lab-step active">01 Brief → Spec</span>
                    <span class="lab-step active">02 Market Creatives</span>
                    <span class="lab-step">03 Consistency Lab · optional</span>
                    <span class="lab-step">04 Loop</span>
                </div>
            </div>
            <div class="lab-visual-stage" aria-label="Creative signal visualization">
                <div class="stage-grid"></div>
                <div class="stage-blue-block"></div>
                <div class="stage-coral-block"></div>
                <div class="stage-lime-rule"></div>
                <div class="stage-disc"></div>
                <div class="stage-meta">Live creative <span>signal</span> / 001</div>
                <div class="stage-copy">MAKE<br>IT<br>MEMORABLE.</div>
            </div>
        </section>
        """,
        unsafe_allow_html=True,
    )


def _resolve_style_preference() -> str:
    choice = st.session_state.get("brief_style_choice", "")
    if choice == "自定义":
        return st.session_state.get("brief_style_custom", "")
    return choice


PLATFORM_OPTIONS = [
    "TikTok",
    "Instagram",
    "YouTube Shorts",
    "Facebook",
    "Amazon",
    "自定义",
]


def _resolve_platform() -> str:
    choice = st.session_state.get("brief_platform_choice", "")
    if choice == "自定义":
        return st.session_state.get("brief_platform_custom", "")
    return choice


def _invalidate_ab_results() -> None:
    st.session_state.pop("ab_experiment_manifest", None)
    st.session_state.pop("ab_experiment_resumed", None)


def _invalidate_derivation_results() -> None:
    """Keep experiment outputs tied to one confirmed Spec and one creative context."""
    st.session_state.pop("market_creatives", None)
    st.session_state.pop("derivation_raw_output", None)
    st.session_state.pop("derivation_context", None)
    _invalidate_ab_results()


def _has_experiment_prompt_pairs(creatives: Any) -> bool:
    if not isinstance(creatives, list) or not creatives:
        return False
    return all(
        isinstance(creative, dict)
        and isinstance(creative.get("image_prompt"), dict)
        and isinstance(creative.get("video_prompt"), dict)
        and bool(creative["image_prompt"].get("bare_prompt"))
        and bool(creative["video_prompt"].get("bare_prompt"))
        for creative in creatives
    )


def _fill_sample_brief() -> None:
    _invalidate_derivation_results()
    st.session_state["brief_name"] = "运动保温杯"
    st.session_state["brief_selling_points"] = (
        "24小时长效保温保冷\n"
        "大容量便携，适合运动通勤\n"
        "防漏杯盖，单手开合\n"
        "耐摔耐用，易清洁"
    )
    st.session_state["brief_brand_tone"] = "专业可靠 / 年轻活力 / 克制高级 / 都市运动"
    st.session_state["brief_material_hint"] = "磨砂不锈钢"
    st.session_state["brief_target_markets"] = ["美国", "欧洲"]
    st.session_state["brief_platform_choice"] = "TikTok"
    st.session_state["brief_platform_custom"] = ""
    st.session_state["brief_style_choice"] = "运动活力"
    st.session_state["brief_style_custom"] = ""


def _build_brief(uploaded_files: list[Any]) -> Brief:
    images = [
        BriefImage(
            file_name=file.name,
            mime_type=file.type or "image/jpeg",
            data=file.getvalue(),
        )
        for file in uploaded_files
    ]
    return Brief(
        name=st.session_state.get("brief_name", ""),
        selling_points=st.session_state.get("brief_selling_points", ""),
        brand_tone=st.session_state.get("brief_brand_tone", ""),
        target_markets=st.session_state.get("brief_target_markets", []),
        platform=_resolve_platform(),
        style_preference=_resolve_style_preference(),
        material_hint=st.session_state.get("brief_material_hint", ""),
        images=images,
    )


def _oversized_files(uploaded_files: list[Any]) -> list[str]:
    return [
        f"{file.name}（{len(file.getvalue()) / 1024 / 1024:.1f}MB）"
        for file in uploaded_files
        if len(file.getvalue()) > MAX_IMAGE_SIZE_BYTES
    ]


def _show_uploaded_previews(uploaded_files: list[Any]) -> None:
    if not uploaded_files:
        return
    columns = st.columns(min(len(uploaded_files), 3))
    for column, file in zip(columns, uploaded_files):
        with column:
            st.image(file, caption=file.name, width="stretch")


def _render_input_form() -> list[Any]:
    st.markdown(
        """
        <div class="lab-section-title">
            <span class="lab-section-number">01 / INPUT</span>
            <h2>Build the brief.</h2>
        </div>
        """,
        unsafe_allow_html=True,
    )
    action_left, action_right = st.columns([1, 3])
    with action_left:
        st.button("填入示例 Brief", width="stretch", on_click=_fill_sample_brief)
    with action_right:
        st.caption("先用示例感受信息结构；生成前仍需要上传真实商品图。")

    upload_col, brief_col = st.columns([0.92, 1.35], gap="large")

    with upload_col:
        with st.container(border=True):
            st.markdown('<p class="lab-panel-title">Product Images</p>', unsafe_allow_html=True)
            st.markdown(
                '<p class="lab-panel-copy">上传 1-3 张主体清晰的商品图。白底图、单品图或细节图最适合抽取稳定视觉锚点。</p>',
                unsafe_allow_html=True,
            )
        uploaded_files = st.file_uploader(
            "商品图片",
            type=["png", "jpg", "jpeg", "webp"],
            accept_multiple_files=True,
        )
        uploaded_files = uploaded_files or []
        if len(uploaded_files) > 3:
            st.error("最多上传 3 张商品图片。")
        oversized = _oversized_files(uploaded_files)
        if oversized:
            st.error(f"单张图片请控制在 {MAX_IMAGE_SIZE_MB}MB 以内：{', '.join(oversized)}")
        _show_uploaded_previews(uploaded_files[:3])
        st.markdown(
            f'<div class="lab-note">建议单图不超过 {MAX_IMAGE_SIZE_MB}MB；如果图片含多个商品，请优先选择主体最清楚的一张作为第一张。</div>',
            unsafe_allow_html=True,
        )

    with brief_col:
        with st.container(border=True):
            st.markdown('<p class="lab-panel-title">Brief Inputs</p>', unsafe_allow_html=True)
            st.markdown(
                '<p class="lab-panel-copy">把“为什么买”“品牌像谁”“这次怎么拍”分开填写，模型会据此生成结构化 Spec。</p>',
                unsafe_allow_html=True,
            )
            st.text_input("商品名称", key="brief_name")
            st.text_area(
                "核心卖点",
                height=140,
                key="brief_selling_points",
                placeholder="写消费者会买单的功能/利益点，可分行写多条。\n例：24小时长效保温保冷\n大容量便携，单手开合\n防漏防摔，适合运动通勤",
                help="只写功能、利益、使用价值；不要写“高级感、清新、运动风”这类调性词，也不要写外观描述。",
            )
            st.multiselect(
                "目标市场",
                options=["美国", "欧洲", "日本", "韩国", "东南亚"],
                default=["美国"],
                key="brief_target_markets",
                on_change=_invalidate_derivation_results,
            )
            st.text_area(
                "品牌调性",
                height=140,
                key="brief_brand_tone",
                placeholder="品牌长期想传递的人格与气质。\n例：专业可靠 / 年轻活力 / 克制高级 / 亲和温暖",
                help="品牌调性是“品牌像什么样的人”，会进入 Spec；风格倾向是“这次素材怎么拍”，本步只记录给后续派生使用。",
            )
            st.text_input(
                "材质（可选）",
                key="brief_material_hint",
                placeholder="如：磨砂不锈钢 / 哑光铝合金 / 食品级塑料",
                help="AI 从图片较难准确判断材质（磨砂不锈钢常被误判成塑料）。若你知道真实材质，填在这里会以你填的为准。",
            )
            platform_choice = st.selectbox(
                "平台",
                options=PLATFORM_OPTIONS,
                key="brief_platform_choice",
                on_change=_invalidate_derivation_results,
            )
            if platform_choice == "自定义":
                st.text_input(
                    "自定义平台",
                    placeholder="如 小红书 / Pinterest / Snapchat",
                    key="brief_platform_custom",
                    on_change=_invalidate_derivation_results,
                )
            style_choice = st.selectbox(
                "风格倾向",
                options=[
                    "简约高级",
                    "运动活力",
                    "清新治愈",
                    "都市时尚",
                    "温馨生活",
                    "科技未来",
                    "日系自然",
                    "潮流个性",
                    "自定义",
                ],
                key="brief_style_choice",
                on_change=_invalidate_derivation_results,
                help="风格倾向用于后续广告素材派生，本步 Spec 抽取不会把它混入商品身份或卖点。",
            )
            if style_choice == "自定义":
                st.text_input(
                    "自定义风格",
                    placeholder="用一两个词描述，如 复古胶片 / 极简性冷淡 / 国潮东方",
                    key="brief_style_custom",
                    on_change=_invalidate_derivation_results,
                )

            st.markdown(
                '<div class="lab-note">核心卖点进入 selling_points；品牌调性进入 brand_tone；风格倾向只为后续广告派生预留。</div>',
                unsafe_allow_html=True,
            )
            generate = st.button("生成 Spec", type="primary", width="stretch")

    if generate:
        if len(uploaded_files) < 1:
            st.error("请至少上传 1 张商品图片。")
        elif len(uploaded_files) > 3:
            st.error("最多上传 3 张商品图片。")
        elif _oversized_files(uploaded_files):
            st.error(f"单张图片请控制在 {MAX_IMAGE_SIZE_MB}MB 以内。")
        else:
            _generate_spec(uploaded_files)

    return uploaded_files


def _generate_spec(uploaded_files: list[Any]) -> None:
    try:
        brief = _build_brief(uploaded_files)
    except ValidationError as exc:
        st.error("Brief 输入不完整或格式不正确。")
        with st.expander("查看校验详情"):
            st.exception(exc)
        return

    settings = get_settings()
    if not settings.openai_api_key and settings.llm_provider == "openai":
        st.error("未检测到 OPENAI_API_KEY，请确认项目根目录 `.env` 已配置。")
        return

    with st.spinner("正在读取图片并生成 Spec..."):
        try:
            graph = build_spec_graph()
            result = graph.invoke({"brief": brief})
            spec = ProductSpec.model_validate(result["spec"])
        except SpecExtractionError as exc:
            st.error(str(exc))
            if exc.attempt_errors:
                with st.expander("重试记录", expanded=True):
                    for index, error in enumerate(exc.attempt_errors, start=1):
                        st.write(f"{index}. {error}")
            if exc.last_raw_output:
                with st.expander("最近一次原始输出"):
                    st.code(exc.last_raw_output[:4000], language="json")
            return
        except Exception as exc:
            logger.exception("Unexpected error while generating spec")
            st.error("生成 Spec 时出现未预期错误。")
            with st.expander("查看调试详情"):
                st.exception(exc)
            return

    st.session_state.pop("confirmed_spec", None)
    _invalidate_derivation_results()
    st.session_state["generated_spec"] = spec.model_dump()
    st.session_state["raw_output"] = result.get("raw_output", "")
    st.session_state["source_images"] = [
        {
            "file_name": image.file_name,
            "mime_type": image.mime_type,
            "data": image.data,
            "sha256": hashlib.sha256(image.data).hexdigest(),
        }
        for image in brief.images
    ]
    st.session_state["derivation_context"] = DerivationContext(
        target_markets=brief.target_markets,
        platform=brief.platform,
        style_preference=brief.style_preference,
    ).model_dump()
    st.session_state["spec_version"] = st.session_state.get("spec_version", 0) + 1
    st.success("Spec 已生成，可以继续编辑。")


def _widget_key(name: str) -> str:
    return f"{name}_{st.session_state.get('spec_version', 0)}"


def _color_editor(prefix: str, color: dict[str, Any], label: str) -> dict[str, str]:
    name_col, hex_col = st.columns([2, 1])
    with name_col:
        name = st.text_input(f"{label}名称", value=str(color.get("name", "")), key=_widget_key(f"{prefix}_name"))
    with hex_col:
        hex_value = st.text_input(f"{label}色值", value=str(color.get("hex", "")), key=_widget_key(f"{prefix}_hex"))
    return {"name": name, "hex": hex_value}


def _json_bytes(data: dict[str, Any]) -> bytes:
    return json.dumps(data, ensure_ascii=False, indent=2).encode("utf-8")


def _render_spec_editor(spec_data: dict[str, Any]) -> None:
    spec = ProductSpec.model_validate(spec_data)
    data = spec.model_dump()
    visual_anchor = data["visual_anchor"]

    st.markdown(
        """
        <section class="lab-result-head">
            <div class="lab-section-title">
                <span class="lab-section-number">GENERATED OUTPUT</span>
                <h2>Editable Visual Anchor Spec</h2>
            </div>
            <p class="lab-panel-copy">
                先检查视觉锚点是否足够具体，再确认 Spec。确认后的 JSON 会保存在 session_state，并可下载留档。
            </p>
        </section>
        """,
        unsafe_allow_html=True,
    )

    dl_col, raw_col = st.columns([1, 3])
    with dl_col:
        st.download_button(
            "下载当前 Spec JSON",
            data=_json_bytes(data),
            file_name="creative_spec.json",
            mime="application/json",
            width="stretch",
        )
    with raw_col:
        st.caption("建议重点核对：主色、材质、品牌标识、独特结构件、anchor_sentence。")

    with st.expander("➕ 增删条目（卖点 / 独特细节 / 视觉禁忌 / 品牌调性）", expanded=True):
        st.caption("调大对应数字，下方就会多出一个空白项，供你补充自己的内容；调小则删除末尾项。")
        c1, c2, c3, c4 = st.columns(4)
        secondary_count = c1.number_input(
            "辅助色数量",
            min_value=0,
            max_value=6,
            value=len(visual_anchor["secondary_colors"]),
            step=1,
            key=_widget_key("secondary_count"),
        )
        detail_count = c2.number_input(
            "独特细节数量",
            min_value=0,
            max_value=8,
            value=len(visual_anchor["distinctive_details"]),
            step=1,
            key=_widget_key("detail_count"),
        )
        selling_count = c3.number_input(
            "卖点数量",
            min_value=1,
            max_value=4,
            value=len(data["selling_points"]),
            step=1,
            key=_widget_key("selling_count"),
        )
        taboo_count = c4.number_input(
            "视觉禁忌数量",
            min_value=0,
            max_value=6,
            value=len(data["visual_taboos"]),
            step=1,
            key=_widget_key("taboo_count"),
        )
        tone_count = st.number_input(
            "品牌调性关键词数量",
            min_value=0,
            max_value=5,
            value=len(data["brand_tone"]),
            step=1,
            key=_widget_key("tone_count"),
        )

    with st.form("spec_editor_form"):
        edited: dict[str, Any] = {}

        identity_tab, visual_tab, message_tab, guardrail_tab = st.tabs(
            ["商品身份", "视觉锚点", "卖点与调性", "禁忌与锚点句"]
        )

        with identity_tab:
            st.markdown("#### Product Identity")
            identity = data["product_identity"]
            edited["product_identity"] = {
                "name": st.text_input("商品名称", value=identity["name"], key=_widget_key("identity_name")),
                "category": st.text_input("品类", value=identity["category"], key=_widget_key("identity_category")),
                "one_line": st.text_input("一句话说明", value=identity["one_line"], key=_widget_key("identity_one_line")),
            }

        with visual_tab:
            st.markdown("#### Visual Anchor")
            edited_visual: dict[str, Any] = {
                "primary_color": _color_editor("primary_color", visual_anchor["primary_color"], "主色"),
            }

            st.markdown("##### 辅助色 Secondary Colors")
            secondary_colors = []
            for index in range(int(secondary_count)):
                default_color = visual_anchor["secondary_colors"][index] if index < len(visual_anchor["secondary_colors"]) else {"name": "", "hex": ""}
                secondary_colors.append(_color_editor(f"secondary_color_{index}", default_color, f"辅助色 {index + 1}"))
            edited_visual["secondary_colors"] = secondary_colors

            edited_visual["material"] = st.text_input("材质与质感", value=visual_anchor["material"], key=_widget_key("material"))
            edited_visual["silhouette"] = st.text_input("版型/轮廓", value=visual_anchor["silhouette"], key=_widget_key("silhouette"))

            marking = visual_anchor["brand_marking"]
            st.markdown("##### 品牌标识 Brand Marking")
            marking_type = st.selectbox(
                "标识类型",
                options=["none", "wordmark", "graphic_mark", "combined_mark", "unreadable"],
                index=["none", "wordmark", "graphic_mark", "combined_mark", "unreadable"].index(marking["mark_type"]),
                format_func={
                    "none": "无品牌标识",
                    "wordmark": "文字品牌名",
                    "graphic_mark": "图形徽标",
                    "combined_mark": "图文组合标识",
                    "unreadable": "标识不可读",
                }.get,
                key=_widget_key("marking_type"),
            )
            marking_cols = st.columns(2)
            edited_visual["brand_marking"] = {
                "mark_type": marking_type,
                "text_content": marking_cols[0].text_input(
                    "可读文字内容", value=marking["text_content"], key=_widget_key("marking_text")
                ),
                "graphic_description": marking_cols[1].text_input(
                    "图形内容描述", value=marking["graphic_description"], key=_widget_key("marking_graphic")
                ),
                "position": marking_cols[0].text_input(
                    "标识位置", value=marking["position"], key=_widget_key("marking_position")
                ),
                "application_method": marking_cols[1].text_input(
                    "呈现工艺", value=marking["application_method"], key=_widget_key("marking_method")
                ),
                "appearance": marking_cols[0].text_input(
                    "视觉表现", value=marking["appearance"], key=_widget_key("marking_appearance")
                ),
                "preservation_level": marking_cols[1].selectbox(
                    "生成保留级别",
                    options=["required", "best_effort", "omit_if_unclear"],
                    index=["required", "best_effort", "omit_if_unclear"].index(marking["preservation_level"]),
                    format_func={
                        "required": "必须保留",
                        "best_effort": "尽力保留",
                        "omit_if_unclear": "不清晰时省略",
                    }.get,
                    key=_widget_key("marking_preservation"),
                ),
            }
            if marking_type == "wordmark":
                st.caption("精确文字为商业硬要求时，建议后续配合真实品牌资产或局部编辑；纯文生图只能尽力复现。")

            st.markdown("##### 独特细节")
            details = []
            for index in range(int(detail_count)):
                default_detail = visual_anchor["distinctive_details"][index] if index < len(visual_anchor["distinctive_details"]) else ""
                details.append(st.text_input(f"细节 {index + 1}", value=default_detail, key=_widget_key(f"detail_{index}")))
            edited_visual["distinctive_details"] = details
            edited_visual["proportions"] = st.text_input("尺寸比例特征", value=visual_anchor["proportions"], key=_widget_key("proportions"))
            edited["visual_anchor"] = edited_visual

        with message_tab:
            st.markdown("#### Selling Points")
            selling_points = []
            for index in range(int(selling_count)):
                default_point = data["selling_points"][index] if index < len(data["selling_points"]) else {"point": "", "priority": index + 1}
                point_col, priority_col = st.columns([4, 1])
                selling_points.append(
                    {
                        "point": point_col.text_input(f"卖点 {index + 1}", value=default_point["point"], key=_widget_key(f"selling_point_{index}")),
                        "priority": priority_col.number_input(
                            "优先级",
                            min_value=1,
                            max_value=4,
                            value=int(default_point["priority"]),
                            step=1,
                            key=_widget_key(f"selling_priority_{index}"),
                        ),
                    }
                )
            edited["selling_points"] = selling_points

            st.markdown("#### Brand Tone")
            edited["brand_tone"] = [
                st.text_input(
                    f"关键词 {index + 1}",
                    value=data["brand_tone"][index] if index < len(data["brand_tone"]) else "",
                    key=_widget_key(f"brand_tone_{index}"),
                )
                for index in range(int(tone_count))
            ]

        with guardrail_tab:
            st.markdown("#### Visual Taboos")
            edited["visual_taboos"] = [
                st.text_input(
                    f"禁忌 {index + 1}",
                    value=data["visual_taboos"][index] if index < len(data["visual_taboos"]) else "",
                    key=_widget_key(f"visual_taboo_{index}"),
                )
                for index in range(int(taboo_count))
            ]

            st.markdown("#### Anchor Sentence")
            edited["anchor_sentence"] = st.text_area(
                "视觉锚点句",
                value=data["anchor_sentence"],
                height=90,
                key=_widget_key("anchor_sentence"),
            )

        confirm = st.form_submit_button("确认 Spec", type="primary", width="stretch")

    if confirm:
        try:
            confirmed = ProductSpec.model_validate(edited)
        except ValidationError as exc:
            st.error("Spec 校验未通过，请检查字段内容。")
            with st.expander("查看校验详情"):
                st.exception(exc)
            return
        st.session_state["confirmed_spec"] = confirmed.model_dump()
        st.session_state["generated_spec"] = confirmed.model_dump()
        _invalidate_derivation_results()
        st.success("Spec 已确认并保存到 session_state。")

    if "confirmed_spec" in st.session_state:
        st.success("Confirmed Spec 已保存。")
        confirm_col, preview_col = st.columns([1, 3])
        with confirm_col:
            st.download_button(
                "下载已确认 JSON",
                data=_json_bytes(st.session_state["confirmed_spec"]),
                file_name="confirmed_creative_spec.json",
                mime="application/json",
                width="stretch",
            )
        with preview_col:
            with st.expander("已确认 Spec JSON", expanded=True):
                st.json(st.session_state["confirmed_spec"], expanded=True)

    if st.session_state.get("raw_output"):
        with st.expander("LLM 原始输出", expanded=False):
            st.code(st.session_state["raw_output"], language="json")


def _default_derivation_context() -> DerivationContext:
    saved = st.session_state.get("derivation_context")
    if saved:
        return DerivationContext.model_validate(saved)
    return DerivationContext(
        target_markets=st.session_state.get("brief_target_markets", ["美国"]),
        platform=_resolve_platform() or "TikTok",
        style_preference=_resolve_style_preference() or "简约高级",
    )


def _render_market_creatives() -> None:
    try:
        spec = ProductSpec.model_validate(st.session_state["confirmed_spec"])
        defaults = _default_derivation_context()
    except ValidationError as exc:
        st.error("无法读取已确认的 Spec 或 Brief 上下文。")
        with st.expander("查看校验详情"):
            st.exception(exc)
        return

    if "market_creatives" in st.session_state and not _has_experiment_prompt_pairs(
        st.session_state["market_creatives"]
    ):
        _invalidate_derivation_results()
        st.info("历史创意缺少裸版 Prompt，已失效。请重新生成广告创意后再用于 A/B 对照。")

    st.markdown(
        """
        <section class="lab-result-head">
            <div class="lab-section-title">
                <span class="lab-section-number">02 / MARKET CREATIVE ENGINE</span>
                <h2>Turn one anchor into local creative systems.</h2>
            </div>
            <p class="lab-panel-copy">
                每个市场会生成 Hook、CTA、15 秒分镜与图片/视频 Prompt。最终 Prompt 会由系统固定加入已确认的商品视觉锚点和禁忌，避免多版本商品漂移。
            </p>
        </section>
        """,
        unsafe_allow_html=True,
    )

    selected_markets = st.multiselect(
        "本次派生市场",
        options=["美国", "欧洲", "日本", "韩国", "东南亚"],
        default=defaults.target_markets,
        key="derivation_target_markets",
        on_change=_invalidate_derivation_results,
        help="可按本次需求选择一个或多个市场；每个市场都会获得独立本地化版本。",
    )
    context_col, action_col = st.columns([3, 1])
    with context_col:
        st.caption(
            f"Platform · {defaults.platform}   |   Style · {defaults.style_preference}   |   Source · Confirmed Spec"
        )
    with action_col:
        generate = st.button("生成广告创意", type="primary", width="stretch")

    if generate:
        try:
            context = DerivationContext(
                target_markets=selected_markets,
                platform=defaults.platform,
                style_preference=defaults.style_preference,
            )
        except ValidationError as exc:
            st.error("请至少选择一个目标市场。")
            with st.expander("查看校验详情"):
                st.exception(exc)
            return
        _generate_market_creatives(spec, context)

    if "market_creatives" in st.session_state:
        _render_market_creative_results(st.session_state["market_creatives"])
        _render_ab_experiment(st.session_state["market_creatives"])

    if st.session_state.get("derivation_raw_output"):
        with st.expander("Market Creative LLM 原始输出", expanded=False):
            st.code(st.session_state["derivation_raw_output"], language="json")


def _generate_market_creatives(spec: ProductSpec, context: DerivationContext) -> None:
    settings = get_settings()
    if not settings.openai_api_key and settings.llm_provider == "openai":
        st.error("未检测到 OPENAI_API_KEY，请确认项目根目录 `.env` 已配置。")
        return

    with st.spinner("正在生成多市场创意与锚定 Prompt..."):
        try:
            graph = build_derivation_graph()
            result = graph.invoke({"spec": spec, "context": context})
        except CreativeDerivationError as exc:
            st.error(str(exc))
            if exc.attempt_errors:
                with st.expander("重试记录", expanded=True):
                    for index, error in enumerate(exc.attempt_errors, start=1):
                        st.write(f"{index}. {error}")
            if exc.last_raw_output:
                with st.expander("最近一次原始输出"):
                    st.code(exc.last_raw_output[:6000], language="json")
            return
        except Exception as exc:
            logger.exception("Unexpected error while deriving market creatives")
            st.error("生成多市场创意时出现未预期错误。")
            with st.expander("查看调试详情"):
                st.exception(exc)
            return

    _invalidate_ab_results()
    st.session_state["market_creatives"] = result["creatives"]
    st.session_state["derivation_raw_output"] = result.get("raw_output", "")
    st.session_state["derivation_context"] = context.model_dump()
    st.success(f"已生成 {len(result['creatives'])} 个市场版本。")


def _render_market_creative_results(creatives_data: list[dict[str, Any]]) -> None:
    if not creatives_data:
        return

    st.markdown(
        """
        <section class="lab-result-head">
            <div class="lab-section-title">
                <span class="lab-section-number">CREATIVE OUTPUTS</span>
                <h2>Local ideas, one product signal.</h2>
            </div>
            <p class="lab-panel-copy">每条 Prompt 同时提供裸版与锚定版，两者共享同一市场创意方向，可作为 Day5 的受控 A/B 输入。</p>
        </section>
        """,
        unsafe_allow_html=True,
    )
    download_col, note_col = st.columns([1, 3])
    with download_col:
        st.download_button(
            "下载 Market Creatives JSON",
            data=_json_bytes({"creatives": creatives_data}),
            file_name="market_creatives.json",
            mime="application/json",
            width="stretch",
        )
    with note_col:
        st.caption("对照原则：Control 由商品名称、品类和裸版市场方向确定性组装；Treatment 仅额外加入固定商品锚点。")

    tabs = st.tabs([f"{item['market']} / {item['language']}" for item in creatives_data])
    for tab, creative in zip(tabs, creatives_data):
        with tab:
            st.caption(f"Local focus · {creative['localization_focus']}")
            st.caption(f"Compliance · {creative['compliance_note']}")

            hook_col, cta_col = st.columns(2)
            with hook_col:
                st.markdown("#### Hook / 前 3 秒")
                st.markdown(f"**{creative['hook']}**")
                st.caption(creative["hook_zh"])
            with cta_col:
                st.markdown("#### CTA / 行动引导")
                st.markdown(f"**{creative['cta']}**")
                st.caption(creative["cta_zh"])

            st.markdown("#### Body Copy")
            st.write(creative["body_copy"])
            st.caption(creative["body_copy_zh"])

            st.markdown("#### 15s Storyboard")
            storyboard_rows = [
                {
                    "镜号": f"0{shot['sequence']}",
                    "时长": f"{shot['duration_seconds']}s",
                    "画面": shot["visual"],
                    "屏显（本地 / 中文）": f"{shot['on_screen_copy']}\n{shot['on_screen_copy_zh']}",
                    "配音（本地 / 中文）": f"{shot['voiceover']}\n{shot['voiceover_zh']}",
                }
                for shot in creative["storyboard"]
            ]
            st.dataframe(storyboard_rows, hide_index=True, width="stretch")

            image_tab, video_tab = st.tabs(["Image Prompt", "Video Prompt"])
            with image_tab:
                anchored_tab, bare_tab = st.tabs(["Anchored Prompt", "Bare Prompt / A-B Baseline"])
                with anchored_tab:
                    st.code(creative["image_prompt"]["prompt"], language="text")
                    st.caption(
                        "引用 Spec 字段：" + " · ".join(creative["image_prompt"]["referenced_spec_fields"])
                    )
                with bare_tab:
                    bare_prompt = creative["image_prompt"].get("bare_prompt")
                    if bare_prompt:
                        st.code(bare_prompt, language="text")
                    else:
                        st.warning("这是旧版本创意，缺少裸版 Prompt。请重新生成广告创意后再用于 A/B 对照。")
            with video_tab:
                anchored_tab, bare_tab = st.tabs(["Anchored Prompt", "Bare Prompt / A-B Baseline"])
                with anchored_tab:
                    st.code(creative["video_prompt"]["prompt"], language="text")
                    st.caption(
                        "引用 Spec 字段：" + " · ".join(creative["video_prompt"]["referenced_spec_fields"])
                    )
                with bare_tab:
                    bare_prompt = creative["video_prompt"].get("bare_prompt")
                    if bare_prompt:
                        st.code(bare_prompt, language="text")
                    else:
                        st.warning("这是旧版本创意，缺少裸版 Prompt。请重新生成广告创意后再用于 A/B 对照。")


def _render_ab_experiment(creatives_data: list[dict[str, Any]]) -> None:
    source_images = st.session_state.get("source_images", [])
    if not source_images:
        st.warning("当前会话缺少原始商品图。请重新生成并确认 Spec 后再运行 A/B 实验。")
        return

    market_options = [item["market"] for item in creatives_data]
    if len(market_options) < 2:
        st.info("A/B 跨市场一致性实验至少需要两条市场创意，请先选择并生成 2 个以上市场。")
        return

    st.markdown(
        """
        <section class="lab-result-head">
            <div class="lab-section-title">
                <span class="lab-section-number">OPTIONAL · CONSISTENCY LAB</span>
                <h2>Check consistency before you scale.</h2>
            </div>
            <p class="lab-panel-copy">可选步骤，非主流程必经。在批量投产前，用少量测试图 + 盲评，提前确认这套 Spec 会不会把商品生成错、换市场后会不会漂移。适合品牌上新预检、代理商批量投放前质检，或验证锚点本身的价值；普通用户可跳过，直接用上方各市场创意导出。</p>
        </section>
        """,
        unsafe_allow_html=True,
    )
    st.caption("对照原理：Arm A 只含商品名称、品类与市场方向；Arm B 仅额外加入结构化商品锚点，生成设置完全相同——两臂唯一差别就是锚点。")
    st.warning("本对照为小样本定性演示，不是统计显著性结论。最终结论应同时参考盲化 LLM 评分与人工评分。")

    with st.expander("恢复已跑过的实验（跨会话，不重新花钱生成图片）", expanded=False):
        existing_ids = list_experiment_ids()
        if existing_ids:
            st.caption("检测到本机磁盘上已有的实验：" + "、".join(existing_ids))
        resume_id = st.text_input("实验 ID（artifacts/ab_experiments/ 下的文件夹名）", key="ab_resume_id")
        if st.button("加载该实验", key="ab_resume_button") and resume_id.strip():
            try:
                st.session_state["ab_experiment_manifest"] = load_experiment_by_id(resume_id)
                st.session_state["ab_experiment_resumed"] = True
                st.success(f"已加载实验 {resume_id.strip()}，可直接在下方查看结果或补充人工评分。")
            except FileNotFoundError as exc:
                st.error(str(exc))

    _normalize_ab_widget_state(market_options, len(source_images))
    control_col, reference_col = st.columns([1.05, 0.95], gap="large")
    with control_col:
        with st.container(border=True):
            st.markdown("#### Experiment Setup")
            selected_markets = st.multiselect(
                "参与实验的市场",
                options=market_options,
                key="ab_selected_markets",
                on_change=_invalidate_ab_results,
                help="至少选择 2 个市场，才能评估跨市场一致性。",
            )
            size = st.selectbox(
                "图片尺寸",
                options=["1024x1024", "1024x1536", "1536x1024"],
                key="ab_image_size",
                on_change=_invalidate_ab_results,
            )
            quality = st.selectbox(
                "生成质量",
                options=["low", "medium", "high"],
                format_func=lambda value: {"low": "Low / 草稿", "medium": "Medium / 推荐", "high": "High / 高成本"}[value],
                key="ab_image_quality",
                on_change=_invalidate_ab_results,
            )
            sample_count = st.selectbox(
                "每臂样本数",
                options=[1, 2],
                key="ab_samples_per_arm",
                on_change=_invalidate_ab_results,
                help=(
                    "同一 Prompt 独立生成几张图。1 用于快速定性演示；"
                    "2 用于扩样本实验——配合多类商品可把每臂样本数堆到统计检验所需规模。"
                    "样本数翻倍，本次图片数与成本也翻倍。"
                ),
            )
            settings = get_settings()
            st.caption(f"Image model · {settings.openai_image_model}  |  Judge · {settings.openai_judge_model}")
            image_count = len(selected_markets) * 2 * sample_count
            st.metric(
                "本次最多生成",
                f"{image_count} 张",
                help=f"市场数 × 2 个实验臂 × 每臂 {sample_count} 张",
            )
            cost_confirmed = st.checkbox(
                "我确认本次会调用付费图像 API",
                key="ab_cost_confirmed",
            )
    with reference_col:
        with st.container(border=True):
            st.markdown("#### Product References")
            preview_cols = st.columns(len(source_images))
            for index, (column, image) in enumerate(zip(preview_cols, source_images)):
                with column:
                    st.image(image["data"], width="stretch")
                    st.caption(f"{index + 1}. {image['file_name']}")
            primary_reference_index = st.selectbox(
                "主参考图",
                options=list(range(len(source_images))),
                format_func=lambda index: f"{index + 1}. {source_images[index]['file_name']}",
                key="ab_primary_reference_index",
                on_change=_invalidate_ab_results,
                help="主参考图优先用于还原度判断，其余图片作为辅助视角。",
            )

    generation_settings = ABGenerationSettings(
        model=get_settings().openai_image_model,
        size=size,
        quality=quality,
        samples_per_arm=sample_count,
    )
    current_fingerprint: str | None = None
    if selected_markets:
        try:
            prompt_pairs = build_prompt_pairs(
                ProductSpec.model_validate(st.session_state["confirmed_spec"]),
                creatives_data,
                selected_markets,
            )
            current_fingerprint = build_experiment_fingerprint(
                ProductSpec.model_validate(st.session_state["confirmed_spec"]),
                prompt_pairs,
                selected_markets,
                source_images,
                primary_reference_index,
                generation_settings,
            )
        except (ValidationError, ValueError) as exc:
            st.error(f"实验输入未通过检查：{exc}")

    stored_manifest = st.session_state.get("ab_experiment_manifest")
    resumed = st.session_state.get("ab_experiment_resumed", False)
    if (
        stored_manifest
        and not resumed
        and current_fingerprint
        and stored_manifest.get("fingerprint") != current_fingerprint
    ):
        _invalidate_ab_results()
        stored_manifest = None
        st.info("实验输入已经变化，旧结果已失效。")
    if stored_manifest and resumed:
        st.caption(f"当前展示的是恢复自磁盘的实验 `{stored_manifest['experiment_id']}`，与本次会话的 Spec 无关联；若在下方点击「运行 A/B 对照」将基于当前 Spec 开始一次新实验。")

    run_experiment = st.button(
        "运行 A/B 对照",
        type="primary",
        width="stretch",
        disabled=(
            len(selected_markets) < 2
            or not cost_confirmed
            or current_fingerprint is None
        ),
    )
    if len(selected_markets) < 2:
        st.caption("请至少选择 2 个市场。")

    if run_experiment:
        with st.spinner("正在生成两臂图片并进行盲化评估。成功项会立即缓存，请不要重复点击..."):
            try:
                graph = build_ab_experiment_graph()
                result = graph.invoke(
                    {
                        "spec": st.session_state["confirmed_spec"],
                        "creatives": creatives_data,
                        "selected_markets": selected_markets,
                        "source_images": source_images,
                        "primary_reference_index": primary_reference_index,
                        "generation_settings": generation_settings.model_dump(),
                    }
                )
                stored_manifest = result["manifest"]
                st.session_state["ab_experiment_manifest"] = stored_manifest
                st.session_state["ab_experiment_resumed"] = False
                resumed = False
            except Exception as exc:
                logger.exception("Unexpected error while running A/B experiment")
                st.error(f"A/B 实验运行失败：{exc}")

    manifest = st.session_state.get("ab_experiment_manifest")
    if manifest:
        _render_ab_results(manifest)


def _normalize_ab_widget_state(markets: list[str], source_image_count: int) -> None:
    selected = st.session_state.get("ab_selected_markets")
    if not selected or any(market not in markets for market in selected):
        st.session_state["ab_selected_markets"] = list(markets)
    if st.session_state.get("ab_image_size") not in {"1024x1024", "1024x1536", "1536x1024"}:
        st.session_state["ab_image_size"] = "1024x1024"
    if st.session_state.get("ab_image_quality") not in {"low", "medium", "high"}:
        st.session_state["ab_image_quality"] = "medium"
    if st.session_state.get("ab_samples_per_arm") not in {1, 2}:
        st.session_state["ab_samples_per_arm"] = 1
    primary = st.session_state.get("ab_primary_reference_index", 0)
    if not isinstance(primary, int) or primary < 0 or primary >= source_image_count:
        st.session_state["ab_primary_reference_index"] = 0


def _render_ab_results(manifest: dict[str, Any]) -> None:
    experiment_dir = get_experiment_dir(manifest)
    status_text = {
        "generation_partial": "部分图片生成失败，可再次运行以只补失败项",
        "generated": "图片已生成，等待评分",
        "evaluation_partial": "部分自动评分失败，可再次运行以只补失败项",
        "complete": "生成与盲评完成",
    }.get(manifest.get("status"), manifest.get("status", "未知"))
    sample_count = samples_per_arm(manifest)
    st.markdown("### Experiment Results")
    st.caption(
        f"Experiment · {manifest['experiment_id']}  |  Status · {status_text}"
        f"  |  每臂样本 · {sample_count}"
    )

    for error in manifest.get("generation_errors", []):
        sample_note = f" / 样本 {error['sample']}" if error.get("sample") else ""
        st.error(f"{error['market']} / Arm {error['arm']}{sample_note} 生成失败：{error['error']}")
    for error in manifest.get("evaluation_errors", []):
        market = f" / {error['market']}" if error.get("market") else ""
        sample_note = f" / 样本 {error['sample']}" if error.get("sample") else ""
        st.error(f"{error['stage']}{market}{sample_note} 评分失败：{error['error']}")

    _render_manual_scoring(manifest, experiment_dir)

    # 人工盲评在上、按臂揭示在下，且默认关闭：只要页面上标着 "Arm A · Control"，
    # 评分者就能把候选 X/Y 对回实验臂，人工盲评立刻名存实亡。
    reveal = st.toggle(
        "显示实验臂标签、Prompt 与 LLM 盲评分",
        value=False,
        key=f"ab_reveal_{manifest['experiment_id']}",
        help="⚠️ 打开后即可看到哪张图来自哪个实验臂，会破坏人工盲评。请在完成人工评分后再打开。",
    )
    if reveal:
        evaluations = manifest.get("evaluations", {})
        for market in manifest["selected_markets"]:
            st.markdown(f"#### {market}")
            for sample_index in range(sample_count):
                if sample_count > 1:
                    st.caption(f"样本 {sample_index + 1} / {sample_count}")
                arm_columns = st.columns(2, gap="large")
                for column, arm in zip(arm_columns, ("A", "B")):
                    with column:
                        st.caption("Arm A · Control" if arm == "A" else "Arm B · Spec Anchor")
                        _render_generated_image(
                            experiment_dir, manifest, market, arm, sample_index
                        )
            prompt_columns = st.columns(2, gap="large")
            for column, arm in zip(prompt_columns, ("A", "B")):
                with column:
                    with st.expander(f"查看 Arm {arm} Prompt"):
                        st.code(manifest["prompt_pairs"][market][arm], language="text")
            _render_judge_score_block(
                title=f"{market} · 商品还原度盲评分",
                entries=evaluations.get("fidelity", {}).get(market, []),
            )

        _render_judge_score_block(
            title="跨市场商品一致性盲评分",
            entries=evaluations.get("consistency", []),
        )

    action_col, meta_col = st.columns([1, 2])
    with action_col:
        st.download_button(
            "下载完整实验 ZIP",
            data=build_experiment_zip(manifest),
            file_name=f"ab_experiment_{manifest['experiment_id']}.zip",
            mime="application/zip",
            width="stretch",
        )
    with meta_col:
        st.caption("ZIP 包含真实参考图、两臂生成图、Spec、Prompt、模型参数、盲评与人工评分 manifest。")


def _render_generated_image(
    experiment_dir: Path,
    manifest: dict[str, Any],
    market: str,
    arm: str,
    sample_index: int,
) -> None:
    metadata = _image_metadata(manifest, market, arm, sample_index)
    if metadata:
        st.image(str(experiment_dir / Path(metadata["relative_path"])), width="stretch")
    else:
        st.warning("图片尚未生成。")


def _image_metadata(
    manifest: dict[str, Any],
    market: str,
    arm: str,
    sample_index: int,
) -> dict[str, Any] | None:
    samples = manifest.get("images", {}).get(market, {}).get(arm) or []
    return samples[sample_index] if sample_index < len(samples) else None


def _render_judge_score_block(title: str, entries: Any) -> None:
    scored = [entry for entry in (entries or []) if _has_both_arms(entry)]
    if not scored:
        return
    st.markdown(f"**{title}**")
    if len(scored) > 1:
        st.caption(
            f"下表为 {len(scored)} 个样本的均值。各样本的原始分与理由见下方展开项，"
            "统计检验请用 ZIP 里 manifest 的逐样本原始分，不要用这里的均值。"
        )
    rows = [
        {
            "维度": label,
            "Arm A": _mean_dimension_score(scored, "A", key),
            "Arm B": _mean_dimension_score(scored, "B", key),
        }
        for key, label in DIMENSION_LABELS.items()
    ]
    rows.append(
        {
            "维度": "平均分",
            "Arm A": _mean_overall(scored, "A"),
            "Arm B": _mean_overall(scored, "B"),
        }
    )
    st.dataframe(rows, hide_index=True, width="stretch")
    with st.expander("查看盲评理由"):
        for entry in scored:
            if len(scored) > 1:
                st.markdown(f"*样本 {entry.get('sample', '?')}*")
            arm_a_dimensions = _brand_marking_score_dimensions(entry["A"])
            arm_b_dimensions = _brand_marking_score_dimensions(entry["B"])
            for key, label in DIMENSION_LABELS.items():
                st.markdown(
                    f"**{label}**  A: {arm_a_dimensions[key]['reason']}  |  "
                    f"B: {arm_b_dimensions[key]['reason']}"
                )


def _has_both_arms(entry: Any) -> bool:
    return isinstance(entry, dict) and "A" in entry and "B" in entry


def _mean_dimension_score(entries: list[dict[str, Any]], arm: str, key: str) -> float:
    values = [_brand_marking_score_dimensions(entry[arm])[key]["score"] for entry in entries]
    return round(sum(values) / len(values), 2)


def _mean_overall(entries: list[dict[str, Any]], arm: str) -> float:
    values = [entry[arm]["overall"] for entry in entries]
    return round(sum(values) / len(values), 2)


def _brand_marking_score_dimensions(score: dict[str, Any]) -> dict[str, Any]:
    dimensions = dict(score.get("dimensions", {}))
    if "brand_marking" not in dimensions and "logo" in dimensions:
        dimensions["brand_marking"] = dimensions.pop("logo")
    return dimensions


def _render_manual_scoring(manifest: dict[str, Any], experiment_dir: Path) -> None:
    st.markdown("### Human Review / 人工盲评")
    st.caption(
        "按与 LLM 相同的五项 rubric 评分。0 表示严重不符或不一致，5 表示高度还原或高度一致。"
        "候选 X / Y 与实验臂的对应关系由实验指纹确定性打乱，且与 LLM 盲评使用不同 seed，两者互不影响。"
    )
    sample_count = samples_per_arm(manifest)
    raters = manifest.get("manual_scores", {}).get("raters", {})
    if raters:
        st.caption(
            "已保存的评分者："
            + "、".join(
                f"{name}{'（历史数据·非盲评）' if entry.get('blind') is False else ''}"
                for name, entry in raters.items()
            )
        )
    rater_id = st.text_input(
        "评分者标识",
        key=f"manual_rater_{manifest['experiment_id']}",
        help="多名评审各填不同标识，分数分开存放，用于计算评分者一致性。填入已有标识会覆盖该评分者上次的结果。",
    ).strip()
    if not rater_id:
        st.info("填写评分者标识后开始盲评。多名评审请各自使用不同标识，不要共用。")
        return

    existing = raters.get(rater_id, {})
    fidelity_scores: dict[str, list[Any]] = {}
    for market in manifest["selected_markets"]:
        existing_market = existing.get("fidelity", {}).get(market, [])
        scores: list[Any] = []
        for sample_index in range(sample_count):
            mapping = blind_mapping(
                f"{manifest['fingerprint']}:manual:fidelity:{market}:{sample_index}"
            )
            suffix = f" · 样本 {sample_index + 1}" if sample_count > 1 else ""
            with st.expander(f"{market} · 商品还原度{suffix}"):
                candidate_columns = st.columns(2, gap="large")
                for column, candidate_id in zip(candidate_columns, ("X", "Y")):
                    with column:
                        st.caption(f"候选 {candidate_id}")
                        _render_generated_image(
                            experiment_dir, manifest, market, mapping[candidate_id], sample_index
                        )
                edited = st.data_editor(
                    _manual_rows(_sample_entry(existing_market, sample_index), mapping),
                    hide_index=True,
                    width="stretch",
                    disabled=["维度"],
                    column_config={
                        column: st.column_config.NumberColumn(min_value=0, max_value=5, step=1)
                        for column in MANUAL_COLUMNS
                    },
                    key=f"manual_fid_{manifest['experiment_id']}_{rater_id}_{market}_{sample_index}",
                )
                scores.append(_manual_rows_to_scores(edited, mapping))
        fidelity_scores[market] = scores

    consistency_scores: list[Any] = []
    existing_consistency = existing.get("consistency", [])
    for sample_index in range(sample_count):
        mapping = blind_mapping(f"{manifest['fingerprint']}:manual:consistency:{sample_index}")
        suffix = f" · 样本 {sample_index + 1}" if sample_count > 1 else ""
        with st.expander(f"跨市场商品一致性{suffix}", expanded=sample_count == 1):
            for candidate_id in ("X", "Y"):
                st.caption(f"候选 {candidate_id} · 同一方法在各市场的结果")
                market_columns = st.columns(len(manifest["selected_markets"]))
                for column, market in zip(market_columns, manifest["selected_markets"]):
                    with column:
                        st.caption(market)
                        _render_generated_image(
                            experiment_dir, manifest, market, mapping[candidate_id], sample_index
                        )
            edited = st.data_editor(
                _manual_rows(_sample_entry(existing_consistency, sample_index), mapping),
                hide_index=True,
                width="stretch",
                disabled=["维度"],
                column_config={
                    column: st.column_config.NumberColumn(min_value=0, max_value=5, step=1)
                    for column in MANUAL_COLUMNS
                },
                key=f"manual_con_{manifest['experiment_id']}_{rater_id}_{sample_index}",
            )
            consistency_scores.append(_manual_rows_to_scores(edited, mapping))

    incomplete = any(score is None for score in consistency_scores) or any(
        score is None for scores in fidelity_scores.values() for score in scores
    )
    if incomplete:
        st.info(
            "人工评分尚未完成：请把每个还原度表格与一致性表格里的每一格"
            "（候选 X / 候选 Y）都填上 0-5，才能保存。"
        )
    if st.button(
        "保存人工评分",
        width="stretch",
        disabled=incomplete,
        key=f"manual_save_{manifest['experiment_id']}",
    ):
        updated = save_manual_scores(
            manifest,
            rater_id,
            {
                "fidelity": fidelity_scores,
                "consistency": consistency_scores,
                "completed": True,
                "blind": True,
            },
        )
        st.session_state["ab_experiment_manifest"] = updated
        st.success(f"评分者「{rater_id}」的人工盲评已写入 manifest（completed=true, blind=true）。")


def _sample_entry(entries: Any, sample_index: int) -> dict[str, Any]:
    if isinstance(entries, list) and sample_index < len(entries) and entries[sample_index]:
        return entries[sample_index]
    return {}


def _manual_rows(existing: dict[str, Any], mapping: dict[str, str]) -> list[dict[str, Any]]:
    # 默认留空（None）而非预填分数，避免用户不打分直接保存产生虚假的"人工评分"。
    # existing 按实验臂 A/B 存储，这里按盲映射反查回候选 X/Y 显示。
    dimensions_by_candidate = {
        candidate_id: _brand_marking_score_dimensions(existing.get(mapping[candidate_id], {}))
        for candidate_id in ("X", "Y")
    }
    return [
        {
            "维度": label,
            MANUAL_COLUMNS[0]: dimensions_by_candidate["X"].get(key),
            MANUAL_COLUMNS[1]: dimensions_by_candidate["Y"].get(key),
        }
        for key, label in DIMENSION_LABELS.items()
    ]


def _manual_rows_to_scores(edited: Any, mapping: dict[str, str]) -> dict[str, Any] | None:
    """所有维度都填了才返回分数；任一格为空则返回 None（视为未完成）。

    评分者填的是候选 X/Y，落盘前按盲映射还原成实验臂 A/B，并把映射一并存下来备查。
    """
    rows = edited.to_dict("records") if hasattr(edited, "to_dict") else list(edited)
    by_label = {row["维度"]: row for row in rows}
    result: dict[str, Any] = {"blind_mapping": mapping}
    for candidate_id, column in zip(("X", "Y"), MANUAL_COLUMNS):
        dimensions: dict[str, int] = {}
        for key, label in DIMENSION_LABELS.items():
            value = by_label[label][column]
            if value is None or value != value:  # None 或 NaN 表示未填
                return None
            dimensions[key] = int(value)
        result[mapping[candidate_id]] = {
            "dimensions": dimensions,
            "overall": round(sum(dimensions.values()) / len(dimensions), 2),
        }
    return result


def main() -> None:
    _init_page()
    configure_langsmith()
    _render_input_form()

    if "generated_spec" in st.session_state:
        _render_spec_editor(st.session_state["generated_spec"])

    if "confirmed_spec" in st.session_state:
        _render_market_creatives()


if __name__ == "__main__":
    main()
