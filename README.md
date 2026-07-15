# AIGC Creative Lab - Spec + Market Creative + A/B Demo

这个 demo 已实现前三步：

1. 商品 Brief 输入、上传商品图、多模态 LLM 抽取结构化 Spec、Pydantic 校验、页面可编辑并确认 Spec。
2. 基于已确认 Spec，按选中市场派生 Hook、CTA、15 秒分镜、图片 Prompt、视频 Prompt，并自动拼接固定商品锚点。
3. 对相同市场创意运行 Control / Spec Anchor 图像 A/B，并通过盲化多模态 Judge 与人工评分对照商品还原度和跨市场一致性。

尚未实现 agentic loop、素材库或投放看板。

## 安装依赖

```bash
pip install -r requirements.txt
```

## 配置环境变量

项目根目录已有 `.env` 文件，代码会读取：

```env
OPENAI_API_KEY=你的 OpenAI API Key
```

可选配置：

```env
OPENAI_MODEL=gpt-4o
OPENAI_IMAGE_MODEL=gpt-image-2-2026-04-21
OPENAI_JUDGE_MODEL=gpt-4o
OPENAI_REQUEST_TIMEOUT=60
SPEC_MAX_RETRIES=3
LANGSMITH_API_KEY=你的 LangSmith Key
LANGSMITH_PROJECT=aigc-creative-lab-spec
```

只有配置了 `LANGSMITH_API_KEY` 时才会开启 trace；未配置时正常本地运行。

## 运行

```bash
.venv\Scripts\python.exe -m streamlit run app.py
```

Windows 上也可以直接双击 `run_app.bat`，保持弹出的命令行窗口不要关闭，然后打开 `http://localhost:8501/`。

打开页面后：

1. 上传 1-3 张商品图片。
2. 填写商品名称、核心卖点、品牌调性、目标市场、平台、风格倾向。
3. 点击「生成 Spec」。
4. 在页面中编辑生成的 Spec。
5. 点击「确认 Spec」，最终结果会写入 `st.session_state["confirmed_spec"]`。
6. 选择本次要派生的市场，点击「生成 Market Creatives」。
7. 在市场标签页中查看本地化 Hook / CTA、15 秒分镜与可复制的图片/视频 Prompt；也可下载完整 JSON。
8. 在 A/B 区至少选择两个市场，选择主参考图、尺寸和质量，确认付费调用后运行对照。
9. 查看两臂图片、盲评五项分数，录入人工评分并下载完整实验 ZIP。

填写建议：

- 核心卖点：只写功能、利益、使用价值或购买理由，例如保温、防漏、便携、耐用。
- 品牌调性：写品牌长期气质，例如专业可靠、年轻活力、克制高级。
- 风格倾向：写这次素材的视觉拍摄方向，本步会记录为后续派生预留，不会混入商品身份或卖点。
- 单张商品图片建议控制在 10MB 以内，避免上传和模型请求超时。

### 多市场派生说明

- 美国、欧洲、日本、韩国、东南亚会分别采用对应的文案语言、本地化表达和合规提醒，而不是只做翻译。
- 每套创意包含 3-4 个连续分镜，时长总和严格为 15 秒；第 1 镜必须在前 3 秒呈现 Hook。
- 每条图片/视频 Prompt 同时提供一对受控实验输入：`Bare Prompt`（Control 臂）保留市场创意方向，并附商品名称与品类作为基础上下文，但不含任何结构化视觉锚点；`Anchored Prompt`（Treatment 臂）在完全相同的方向前固定拼接已确认的 `anchor_sentence`、色彩、材质、轮廓、logo、独特细节与视觉禁忌。两臂唯一差别就是这段商品锚点。
- 用这对 Prompt 做 A/B 时，请保持市场、平台、风格、生成模型、尺寸比例、随机种子（如生成工具支持）一致；唯一变量应是商品锚点段。
- 每条 Prompt 下方会显示引用的 Spec 字段，方便检查与复现。
- 模型只能在用户确认的 `selling_points` 范围内组织利益点，不会自行添加功能、价格、认证或效果承诺。
- 重新确认 Spec，或修改市场、平台、风格后，旧的市场创意会自动失效，避免将旧 Prompt 用于新的对照实验。

### A/B 实验说明

- Arm A 使用商品名称、品类和市场创意方向；Arm B 使用相同方向并额外加入完整 `anchor_block`。
- Control 生成前会检查颜色、hex、材质、logo、轮廓、独特部件和 anchor sentence 是否泄漏。
- 两臂使用相同图像模型快照、尺寸和质量，每臂每市场生成 1 张；真实商品图只用于评估，不会作为生成输入。
- LLM Judge 只看到随机编号 Candidate X/Y，不会收到 A/B 标签、Prompt 或实验假设。
- 颜色、Logo、材质、轮廓比例和独特部件各按 0-5 分评估，总分由程序计算平均值。
- 成功图片和评分按实验指纹缓存。局部失败后再次运行只补失败项，避免重复生成已付费图片。
- Spec、源图、市场、平台、风格、Prompt、模型、尺寸或质量变化后，当前页面中的旧实验结果会失效。
- 实验写入 `artifacts/ab_experiments/<experiment_id>/`，该目录已加入 `.gitignore`；下载 ZIP 含参考图、生成图和完整 manifest。
- 这是小样本方向性实验，不应表述为统计显著性结论。

## 调试与验收

- 控制台会记录每次 LLM 调用的输入摘要、原始输出、解析结果和错误。
- 图片只记录文件名、MIME 类型和大小，不记录 base64。
- API Key 不会被打印或写入日志。
- Spec 抽取和多市场派生的 LLM 调用失败、超时、JSON 解析失败、Schema 校验失败都会重试，最多 3 次。
- 3 次仍失败时，页面会显示明确错误和最近一次原始输出摘要。
- `.gitignore` 已包含 `.env`，避免后续误提交 Key。

### 模拟坏输出

如需验证重试和报错逻辑，可临时在 `.env` 中设置：

```env
LLM_PROVIDER=mock_bad_json
```

再运行页面并点击「生成 Spec」，它会连续返回坏 JSON，触发 3 次失败后的页面报错。测试完改回：

```env
LLM_PROVIDER=openai
```
