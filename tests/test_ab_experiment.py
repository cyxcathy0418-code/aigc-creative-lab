from __future__ import annotations

import base64
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from streamlit.testing.v1 import AppTest

import app
from src.ab_eval import BaseABJudge, JudgeCallResult
from src.ab_experiment import (
    BaseImageGenerator,
    build_control_prompt,
    build_experiment_zip,
    find_anchor_leaks,
    migrate_legacy_single_sample,
)
from src.derivation_retry import _build_prompt_artifact
from src.prompts import build_anchor_block, build_creative_safe_spec_view, format_derivation_prompt
from src.graph import build_ab_experiment_graph
from src.schemas import (
    ABGenerationSettings,
    BlindCandidateScore,
    BlindJudgeResponse,
    DerivationContext,
    JudgeDimension,
    MarketCreative,
    ProductIdentityScores,
    ProductSpec,
)


PNG_1X1_B64 = (
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII="
)


class FakeImageGenerator(BaseImageGenerator):
    def __init__(self) -> None:
        self.calls: list[str] = []

    def generate(self, prompt: str, settings: ABGenerationSettings) -> tuple[bytes, str]:
        self.calls.append(prompt)
        return b"fake-png-" + str(len(self.calls)).encode(), "image/png"


class FakeJudge(BaseABJudge):
    model_name = "fake-vision"

    def __init__(self) -> None:
        self.fidelity_calls = 0
        self.consistency_calls = 0

    def judge_fidelity(self, reference_images, candidates) -> JudgeCallResult:
        self.fidelity_calls += 1
        return _judge_result()

    def judge_consistency(self, candidate_groups) -> JudgeCallResult:
        self.consistency_calls += 1
        return _judge_result()


def _judge_result() -> JudgeCallResult:
    def candidate(candidate_id: str, score: int) -> BlindCandidateScore:
        dimension = lambda: JudgeDimension(score=score, reason="可观察差异")
        return BlindCandidateScore(
            candidate_id=candidate_id,
            dimensions=ProductIdentityScores(
                color=dimension(),
                logo=dimension(),
                material=dimension(),
                silhouette=dimension(),
                distinctive_details=dimension(),
            ),
        )

    parsed = BlindJudgeResponse(candidates=[candidate("X", 2), candidate("Y", 4)])
    return JudgeCallResult(parsed=parsed, raw_output=parsed.model_dump_json(), attempts=1)


def _spec() -> ProductSpec:
    return ProductSpec.model_validate(
        {
            "product_identity": {"name": "KIVRA", "category": "保温杯", "one_line": "一只保温杯"},
            "visual_anchor": {
                "primary_color": {"name": "深蓝", "hex": "#112233"},
                "secondary_colors": [{"name": "银色", "hex": "#CCCCCC"}],
                "material": "磨砂不锈钢",
                "silhouette": "高瘦直筒",
                "brand_marking": {
                    "mark_type": "wordmark",
                    "text_content": "KIVRA",
                    "graphic_description": "无",
                    "position": "正面中部",
                    "application_method": "丝印",
                    "appearance": "白色细体字、低对比",
                    "preservation_level": "required",
                },
                "distinctive_details": ["黑色提手"],
                "proportions": "高瘦",
            },
            "selling_points": [{"point": "长效保温", "priority": 1}],
            "brand_tone": ["专业"],
            "visual_taboos": ["其他品牌标识"],
            "anchor_sentence": "深蓝磨砂高瘦杯身配白色KIVRA字样和黑色提手",
        }
    )


def _creative(market: str) -> dict:
    prompt_artifact = {
        "prompt": "[ANCHOR]\n[MARKET CREATIVE DIRECTION]\nStudio scene",
        "bare_prompt": "[MARKET CREATIVE DIRECTION - no product anchor]\nStudio scene",
        "anchor_block": "[ANCHOR]",
        "referenced_spec_fields": ["anchor_sentence"],
    }
    return MarketCreative.model_validate(
        {
            "market": market,
            "language": "English",
            "localization_focus": "daily life",
            "compliance_note": "No unsupported claims",
            "hook": "Hook",
            "hook_zh": "钩子",
            "body_copy": "Body",
            "body_copy_zh": "正文",
            "cta": "Shop now",
            "cta_zh": "立即购买",
            "storyboard": [
                {"sequence": 1, "duration_seconds": 5, "visual": "A", "on_screen_copy": "A", "on_screen_copy_zh": "甲", "voiceover": "A", "voiceover_zh": "甲"},
                {"sequence": 2, "duration_seconds": 5, "visual": "B", "on_screen_copy": "B", "on_screen_copy_zh": "乙", "voiceover": "B", "voiceover_zh": "乙"},
                {"sequence": 3, "duration_seconds": 5, "visual": "C", "on_screen_copy": "C", "on_screen_copy_zh": "丙", "voiceover": "C", "voiceover_zh": "丙"},
            ],
            "image_prompt": prompt_artifact,
            "video_prompt": prompt_artifact,
        }
    ).model_dump()


def _ab_app_test() -> AppTest:
    app_test = AppTest.from_file("app.py")
    app_test.session_state["generated_spec"] = _spec().model_dump()
    app_test.session_state["confirmed_spec"] = _spec().model_dump()
    app_test.session_state["source_images"] = [
        {
            "file_name": "product.png",
            "mime_type": "image/png",
            "data": base64.b64decode(PNG_1X1_B64),
            "sha256": "test-image",
        }
    ]
    app_test.session_state["market_creatives"] = [_creative("美国"), _creative("欧洲")]
    app_test.session_state["derivation_context"] = {
        "target_markets": ["美国", "欧洲"],
        "platform": "TikTok",
        "style_preference": "简约高级",
    }
    return app_test


def _disk_manifest(root: Path) -> dict:
    """在磁盘上摆好一个已完成的单样本实验，供渲染测试使用。"""
    image_bytes = base64.b64decode(PNG_1X1_B64)
    experiment_id = "exp_render"
    (root / experiment_id / "generated").mkdir(parents=True)
    markets = ["美国", "欧洲"]
    images: dict = {}
    for market in markets:
        images[market] = {}
        for arm in ("A", "B"):
            relative_path = Path("generated") / f"{market}_arm_{arm}_1.png"
            (root / experiment_id / relative_path).write_bytes(image_bytes)
            images[market][arm] = [
                {
                    "relative_path": relative_path.as_posix(),
                    "mime_type": "image/png",
                    "sha256": f"{market}{arm}",
                    "size_bytes": len(image_bytes),
                    "attempts": 1,
                }
            ]
    return {
        "schema_version": 1,
        "experiment_id": experiment_id,
        "fingerprint": "f" * 64,
        "status": "complete",
        "selected_markets": markets,
        "primary_reference_index": 0,
        "generation_settings": {
            "model": "fake-image",
            "size": "1024x1024",
            "quality": "medium",
            "samples_per_arm": 1,
        },
        "prompt_pairs": {market: {"A": "control prompt", "B": "anchor prompt"} for market in markets},
        "source_images": [],
        "images": images,
        "generation_errors": [],
        "evaluations": {"fidelity": {}, "consistency": []},
        "evaluation_errors": [],
        "manual_scores": {"raters": {}},
    }


def _render_ab_manifest(reveal: bool) -> AppTest:
    """把一个已完成的实验渲染出来；reveal 控制是否揭示实验臂标签。"""
    with tempfile.TemporaryDirectory() as directory:
        root = Path(directory)
        manifest = _disk_manifest(root)
        with patch("src.ab_experiment.ARTIFACTS_ROOT", root):
            app_test = _ab_app_test()
            app_test.session_state["ab_experiment_manifest"] = manifest
            # 标记为「恢复自磁盘」，否则指纹与当前输入不符会被判定失效并清空
            app_test.session_state["ab_experiment_resumed"] = True
            # 填了评分者标识才会渲染打分表格
            app_test.session_state[f"manual_rater_{manifest['experiment_id']}"] = "rater_test"
            app_test.session_state[f"ab_reveal_{manifest['experiment_id']}"] = reveal
            app_test.run(timeout=30)
            return app_test


class ABExperimentTests(unittest.TestCase):
    def test_legacy_logo_is_migrated_to_brand_marking(self) -> None:
        spec_data = _spec().model_dump()
        visual = spec_data["visual_anchor"]
        visual.pop("brand_marking")
        visual["logo"] = {"text": "KIVRA", "position": "正面中部", "style": "白色细体字"}

        migrated = ProductSpec.model_validate(spec_data)

        self.assertEqual(migrated.visual_anchor.brand_marking.mark_type, "wordmark")
        self.assertEqual(migrated.visual_anchor.brand_marking.text_content, "KIVRA")
        self.assertNotIn("logo", migrated.model_dump()["visual_anchor"])

    def test_brand_marking_is_written_into_anchor_with_required_wordmark_rule(self) -> None:
        anchor = build_anchor_block(_spec())

        self.assertIn("KIVRA", anchor)
        self.assertIn("丝印", anchor)
        self.assertIn("If exact text cannot be rendered", anchor)

    def test_derivation_prompt_is_clean_room_and_hides_visual_anchor(self) -> None:
        spec = _spec()
        context = DerivationContext(
            target_markets=["美国", "韩国"],
            platform="TikTok",
            style_preference="简约高级",
        )

        prompt = format_derivation_prompt(spec, context)

        # 净室边界：派生模型看不到任何视觉身份字段，两臂共用的 creative_direction
        # 因此不可能夹带视觉信息。
        self.assertEqual(find_anchor_leaks(prompt, spec), [])
        self.assertNotIn("磨砂不锈钢", prompt)
        self.assertNotIn("一只保温杯", prompt)  # one_line 含轮廓信息，一并排除
        # 非视觉字段仍然可见，否则派生无从下手。
        self.assertIn("保温杯", prompt)
        self.assertIn("长效保温", prompt)
        self.assertIn("专业", prompt)

    def test_creative_safe_view_keeps_only_non_visual_fields(self) -> None:
        view = build_creative_safe_spec_view(_spec())

        self.assertEqual(set(view), {"product_identity", "selling_points", "brand_tone"})
        self.assertEqual(set(view["product_identity"]), {"name", "category"})

    def test_both_arms_share_the_same_creative_direction(self) -> None:
        # A/B 的唯一变量必须是 anchor_block 的有无。若哪天让对照组用另一段
        # 独立生成的 direction，变量就从 1 个变成 2 个——这个断言是防线。
        artifact = _build_prompt_artifact("[ANCHOR]", "Sunrise rooftop, handheld camera")

        self.assertEqual(artifact.prompt, f"[ANCHOR]\n\n{artifact.bare_prompt}")
        self.assertIn("Sunrise rooftop, handheld camera", artifact.bare_prompt)
        self.assertNotIn("[ANCHOR]", artifact.bare_prompt)

    def test_control_prompt_has_basic_product_context_without_anchor(self) -> None:
        creative = MarketCreative.model_validate(_creative("美国"))
        prompt = build_control_prompt(_spec(), creative)
        self.assertIn("KIVRA (保温杯)", prompt)
        self.assertNotIn("#112233", prompt)
        self.assertEqual(find_anchor_leaks(prompt, _spec()), [])

    def test_graph_caches_paid_generation_and_judging(self) -> None:
        generator = FakeImageGenerator()
        judge = FakeJudge()
        source_images = [{"file_name": "product.png", "mime_type": "image/png", "data": b"product"}]
        state = {
            "spec": _spec().model_dump(),
            "creatives": [_creative("美国"), _creative("欧洲")],
            "selected_markets": ["美国", "欧洲"],
            "source_images": source_images,
            "primary_reference_index": 0,
            "generation_settings": ABGenerationSettings(model="fake-image").model_dump(),
        }

        with tempfile.TemporaryDirectory() as directory, patch(
            "src.ab_experiment.ARTIFACTS_ROOT", Path(directory)
        ):
            graph = build_ab_experiment_graph(generator=generator, judge=judge)
            first = graph.invoke(state)["manifest"]
            self.assertEqual(first["status"], "complete")
            self.assertEqual(len(generator.calls), 4)
            self.assertEqual(judge.fidelity_calls, 2)
            self.assertEqual(judge.consistency_calls, 1)
            self.assertGreater(len(build_experiment_zip(first)), 0)

            second = graph.invoke(state)["manifest"]
            self.assertEqual(second["status"], "complete")
            self.assertEqual(len(generator.calls), 4)
            self.assertEqual(judge.fidelity_calls, 2)
            self.assertEqual(judge.consistency_calls, 1)

    def test_multi_sample_generates_each_sample_independently_and_scores_each(self) -> None:
        generator = FakeImageGenerator()
        judge = FakeJudge()
        source_images = [{"file_name": "product.png", "mime_type": "image/png", "data": b"product"}]
        state = {
            "spec": _spec().model_dump(),
            "creatives": [_creative("美国"), _creative("欧洲")],
            "selected_markets": ["美国", "欧洲"],
            "source_images": source_images,
            "primary_reference_index": 0,
            "generation_settings": ABGenerationSettings(
                model="fake-image",
                samples_per_arm=2,
            ).model_dump(),
        }

        with tempfile.TemporaryDirectory() as directory, patch(
            "src.ab_experiment.ARTIFACTS_ROOT", Path(directory)
        ):
            graph = build_ab_experiment_graph(generator=generator, judge=judge)
            manifest = graph.invoke(state)["manifest"]

            self.assertEqual(manifest["status"], "complete")
            self.assertEqual(len(generator.calls), 8)  # 2 市场 × 2 臂 × 2 样本
            # 每个样本各跑一次独立盲评，而不是把 4 张图塞进一次调用
            self.assertEqual(judge.fidelity_calls, 4)  # 2 市场 × 2 样本
            self.assertEqual(judge.consistency_calls, 2)  # 2 样本

            for market in ("美国", "欧洲"):
                for arm in ("A", "B"):
                    samples = manifest["images"][market][arm]
                    self.assertEqual(
                        [Path(item["relative_path"]).name for item in samples],
                        [f"{market}_arm_{arm}_1.png", f"{market}_arm_{arm}_2.png"],
                    )
                    # 两个样本必须各自独立生成，不能是同一张图被复用
                    self.assertNotEqual(samples[0]["sha256"], samples[1]["sha256"])
                self.assertEqual(len(manifest["evaluations"]["fidelity"][market]), 2)
            self.assertEqual(len(manifest["evaluations"]["consistency"]), 2)

    def test_legacy_single_sample_manifest_migrates_to_lists(self) -> None:
        legacy = {
            "images": {
                "美国": {
                    "A": {"relative_path": "generated/美国_arm_A.png", "sha256": "a"},
                    "B": {"relative_path": "generated/美国_arm_B.png", "sha256": "b"},
                }
            },
            "evaluations": {
                "fidelity": {"美国": {"A": {"overall": 1.0}, "B": {"overall": 4.4}}},
                "consistency": {"A": {"overall": 4.8}, "B": {"overall": 4.8}},
            },
            "manual_scores": {
                "fidelity": {"美国": {"A": {"overall": 0.8}, "B": {"overall": 4.2}}},
                "consistency": {"A": {"overall": 4.6}, "B": {"overall": 4.6}},
                "completed": True,
            },
        }

        migrated = migrate_legacy_single_sample(legacy)

        # 旧的单图路径原样保留，旧实验不必重新花钱生成
        self.assertEqual(
            migrated["images"]["美国"]["A"],
            [{"relative_path": "generated/美国_arm_A.png", "sha256": "a"}],
        )
        self.assertEqual(len(migrated["evaluations"]["fidelity"]["美国"]), 1)
        self.assertEqual(len(migrated["evaluations"]["consistency"]), 1)

        rater = migrated["manual_scores"]["raters"]["rater_1"]
        self.assertTrue(rater["completed"])
        self.assertEqual(len(rater["fidelity"]["美国"]), 1)
        self.assertEqual(len(rater["consistency"]), 1)
        # 旧界面直接显示 Arm A / Arm B，那批人工分不是盲评，迁移必须如实标注
        self.assertIs(rater["blind"], False)

    def test_manual_scores_are_stored_by_arm_not_by_blind_label(self) -> None:
        mapping = {"X": "B", "Y": "A"}
        rows = [
            {"维度": label, "候选 X": 5, "候选 Y": 1}
            for label in app.DIMENSION_LABELS.values()
        ]

        scores = app._manual_rows_to_scores(rows, mapping)

        # 评分者填的是候选 X/Y；落盘必须按盲映射还原成实验臂，否则两臂分数会张冠李戴
        self.assertEqual(scores["B"]["overall"], 5.0)
        self.assertEqual(scores["A"]["overall"], 1.0)
        self.assertEqual(scores["blind_mapping"], mapping)

        # 反向：已存的 A/B 分数回填表格时也要按同一映射还原成 X/Y
        rebuilt = app._manual_rows(scores, mapping)
        self.assertEqual(rebuilt[0]["候选 X"], 5)
        self.assertEqual(rebuilt[0]["候选 Y"], 1)

    def test_manual_scores_reject_incomplete_grid(self) -> None:
        mapping = {"X": "A", "Y": "B"}
        rows = [
            {"维度": label, "候选 X": 3, "候选 Y": None}
            for label in app.DIMENSION_LABELS.values()
        ]

        self.assertIsNone(app._manual_rows_to_scores(rows, mapping))

    def test_streamlit_renders_ab_controls_without_api_calls(self) -> None:
        app_test = _ab_app_test()
        app_test.run(timeout=30)
        self.assertEqual(len(app_test.exception), 0)
        self.assertIn("运行 A/B 对照", [button.label for button in app_test.button])

    def test_manual_scoring_stays_blind_until_arms_are_explicitly_revealed(self) -> None:
        # 实验臂标签用 st.caption 渲染，只在 AppTest 的 caption 集合里，不在 markdown 里。
        blind = _render_ab_manifest(reveal=False)
        revealed = _render_ab_manifest(reveal=True)

        self.assertEqual(len(blind.exception), 0)
        self.assertEqual(len(revealed.exception), 0)

        blind_captions = " ".join(element.value for element in blind.caption)
        revealed_captions = " ".join(element.value for element in revealed.caption)

        # 默认状态下评分者只看得到候选 X / Y，看不到哪张来自哪个臂
        self.assertIn("候选 X", blind_captions)
        self.assertNotIn("Arm A · Control", blind_captions)
        self.assertNotIn("Arm B · Spec Anchor", blind_captions)
        # 只有显式打开揭示开关，才会出现实验臂标签
        self.assertIn("Arm A · Control", revealed_captions)
        self.assertIn("Arm B · Spec Anchor", revealed_captions)


if __name__ == "__main__":
    unittest.main()
