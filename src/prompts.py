from __future__ import annotations

import json
from typing import Any

from src.schemas import Brief, DerivationContext, ProductSpec


MARKET_LOCALIZATION_POLICIES = {
    "美国": {
        "language": "English (US)",
        "scene": "个人健身房/晨跑/户外徒步等单人运动场景；选角偏个人主义、多元族裔、自信独立。",
        "angle": "主打个人表现与自我表达，强调“帮我做更好的自己”。首镜优先切入运动/成就感场景。",
        "direction": "直接、有能量、口语化，可用第二人称直接对话；节奏明快。",
        "compliance": "避免“最佳、绝对、保证”等无法证明的功效承诺；人物呈现自然、多元、不刻板；不暗示健康疗效。",
    },
    "欧洲": {
        "language": "English (international)",
        "scene": "极简住宅/安静的清晨日常/可持续生活场景；选角低调、成熟、注重品味。",
        "angle": "主打设计品质、耐用与可持续，强调“用得久、用得讲究”。淡化促销、强调长期价值。",
        "direction": "克制、含蓄、可信，几乎不叫卖；留白多、语气冷静。",
        "compliance": "避免绝对化环保/健康/功效宣称；不假设具体国家、语言或法规；不做夸张对比。",
    },
    "日本": {
        "language": "Japanese",
        "scene": "狭小整洁的居家/通勤/办公桌面等精致小空间；选角注重细节感与生活美学。",
        "angle": "主打精致细节与小巧便携，强调“融入日常、体贴入微”。以细节特写和使用质感切入。",
        "direction": "含蓄、留白、不过分用力；重氛围与质感，不喊口号。",
        "compliance": "避免夸张对比与强迫式促销语；不编造功能认证或限定活动；不制造焦虑。",
    },
    "韩国": {
        "language": "Korean",
        "scene": "潮流咖啡馆/街头/社交分享场景；选角时髦、年轻、有镜头表现力。",
        "angle": "主打设计即时尚单品，强调“拿出来好看、想分享”。以造型感与社交属性切入。",
        "direction": "轻快、时髦、有节奏感；可带社媒/分享语感，但不牺牲信息清晰。",
        "compliance": "避免夸大效果、外貌焦虑或未证实背书；不使用刻板人群形象。",
    },
    "东南亚": {
        "language": "English (Southeast Asia)",
        "scene": "炎热气候下的家庭/多人/日常出行（摩托通勤、市集、户外）场景；选角生活化、贴近真实。",
        "angle": "主打耐用、性价比与炎热天气下的保冷/补水，强调“全家都好用、扛造耐用”。以家庭/多人日常切入。",
        "direction": "明快、真实、易理解；重实用与场景，不追求高冷调性。",
        "compliance": "避免宗教、族群和地域刻板符号；服饰与场景保持得体、尊重当地文化；不用绝对化功效或价格承诺。",
    },
}

# 把抽象的风格词转成具体、可执行的视觉指令，避免不同风格生成的画面几乎相同
STYLE_DIRECTIVES = {
    "简约高级": "极简留白、低饱和高级灰/单色调、克制对称构图、柔和均匀光，去除多余道具。",
    "运动活力": "高饱和撞色、动感镜头（跟拍/甩镜）、阳光户外或运动场景、明亮通透、节奏快。",
    "清新治愈": "柔和自然光、低对比清新色调、舒缓慢节奏、留白与呼吸感、治愈氛围。",
    "都市时尚": "编辑大片感、街头/都市背景、时尚选角、硬光与戏剧化光影、潮流构图。",
    "温馨生活": "暖色调、居家/家庭场景、柔光、生活化道具、亲密温暖的氛围。",
    "科技未来": "冷色调与霓虹点缀、金属/玻璃质感、未来都市背景、光效或全息元素、锐利干净的镜头。",
    "日系自然": "自然光、原木与植物、大量留白、清淡色调、安静的生活美学。",
    "潮流个性": "大胆撞色、Y2K/复古或街头潮流、夸张构图与特写、强烈的个性表达。",
}

ANCHOR_REFERENCE_FIELDS = [
    "product_identity.name",
    "product_identity.category",
    "visual_anchor.primary_color",
    "visual_anchor.secondary_colors",
    "visual_anchor.material",
    "visual_anchor.silhouette",
    "visual_anchor.brand_marking",
    "visual_anchor.distinctive_details",
    "visual_anchor.proportions",
    "selling_points",
    "brand_tone",
    "visual_taboos",
    "anchor_sentence",
]


SPEC_EXTRACTOR_PROMPT = """你是资深电商视觉分析师，擅长把商品图片和信息拆解成结构化档案，用于后续AI广告素材生成的"一致性锚点"。

【任务】
分析用户提供的商品图片和文字信息，输出一份严格符合下述结构的商品结构化档案（JSON）。这份档案的作用是：让后续生成的多版本广告素材中，商品的视觉特征始终保持一致。

【输出结构】
严格输出如下JSON，字段和类型均不得增删或改变，不要输出任何解释文字：
{
  "product_identity": { "name": "", "category": "", "one_line": "" },
  "visual_anchor": {
    "primary_color": { "name": "", "hex": "" },
    "secondary_colors": [ { "name": "", "hex": "" } ],
    "material": "",
    "silhouette": "",
    "brand_marking": {
      "mark_type": "wordmark",
      "text_content": "",
      "graphic_description": "",
      "position": "",
      "application_method": "",
      "appearance": "",
      "preservation_level": "best_effort"
    },
    "distinctive_details": [],
    "proportions": ""
  },
  "selling_points": [ { "point": "", "priority": 1 } ],
  "brand_tone": [],
  "visual_taboos": [],
  "anchor_sentence": ""
}

【规则】
1. 字段来源分两类，不可混淆：
   - 视觉类字段（product_identity、visual_anchor、distinctive_details、proportions、anchor_sentence、visual_taboos）：只依据图片中肉眼可见的内容；禁止根据品牌名称或已有知识，推断任何图片中看不到的信息（如功能、用途、容量、保温时长、是否适配某设备、使用场景）；即使你认识这个品牌，也只描述图片本身呈现的内容。one_line 尤其要注意：只能描述外观和品类归属（例如"一款高挑直筒形保温杯"），不得包含容量、便携性、保温时长等任何功能/用途推断。
   - 文本类字段（selling_points、brand_tone）：来自【已知信息】中用户提供的『核心卖点』和『品牌调性』文字，做提炼概括；不要用商品外观特征来替代真实卖点（例如不要把"高挑杯身造型"当作卖点）；用户未提供则填 "未知"。
   - 核心卖点只提炼消费者能感知的功能、利益、使用价值或购买理由，如保温、防漏、便携、耐用、易清洁；不要把品牌气质、画面风格、审美形容词写进 selling_points。
   - 品牌调性只提炼品牌人格和长期气质，如专业、年轻、可靠、高级、亲和；不要把具体拍摄风格、构图、色调、滤镜、场景写进 brand_tone。
2. 图片看不清、信息未提供的字段，填 "未知"，不要猜测。
3. primary_color / secondary_colors 的 hex 是根据图片估计的近似色值，允许估计但要接近。
4. brand_marking 是商品表面可见的品牌标识，不要将其笼统视为 logo：
   - 无标识：mark_type 填 "none"，其余字段均填 "无"，preservation_level 填 "omit_if_unclear"。
   - 仅有可读文字品牌名：mark_type 填 "wordmark"，text_content 逐字如实填写，graphic_description 填 "无"。
   - 仅有图形/徽标：mark_type 填 "graphic_mark"，text_content 填 "无"，graphic_description 必须描述图形所描绘的具体内容（人物/动物/字母/几何形状及排布），不能只写外形轮廓。
   - 图文组合：mark_type 填 "combined_mark"，同时填写可读文字和图形内容。
   - 文字不可读：mark_type 填 "unreadable"，text_content 填 "未知"，不要猜测或编造品牌名。
   - position 填可见位置；application_method 填压印、雕刻、丝印、贴纸、织标等可见工艺，无法判断填 "未知"；appearance 填颜色、对比度、大小与质感等可见表现。默认 preservation_level 填 "best_effort"。
5. brand_tone 最多输出 5 个简洁关键词（每个不超过 6 字），不要照抄用户提供的长段文案。
6. selling_points 每条提炼到 20 字以内，按重要性排序，最多 4 条。
7. visual_taboos 结合品类常识补充（如廉价感、其他品牌元素、夸大功效文字、缺失核心识别部件等），最多 6 条。
8. anchor_sentence 是最关键的字段：用一句话（60 字以内）浓缩"最能一眼锁定这个商品身份"的视觉特征（颜色+材质+造型+品牌标识+独特部件），要具体、可复现、只含视觉信息，会被拼进每一条生成Prompt。若商品含有手柄、提手、吸管、喷嘴等突出的结构性部件（占据显著画面比例、影响整体轮廓的部件），必须优先纳入 anchor_sentence 和 distinctive_details，不可为了控制字数而省略——结构性部件的优先级高于表面纹理或次要细节。
9. 若商品不同部位材质不同（如杯身、杯盖、手柄、吸管材质不一致），material 字段应分别说明各部位材质，不得用单一材质笼统概括整个商品。
10. 材质特别说明：视觉模型难以从图片准确判断材质（如磨砂不锈钢常被误判为塑料）。若【已知信息】中用户提供了『材质』，material 字段必须以用户提供的为准；仅当用户未提供时，才根据图片谨慎推断。
11. 全部用中文，输出合法 JSON，不含任何 JSON 以外的文字。

【已知信息】
商品名称：{name}
核心卖点：{selling_points}
品牌调性：{brand_tone}
材质（用户提供，可能为空）：{material_hint}
目标市场：{target_markets}
平台：{platform}
风格倾向：{style_preference}

【边界提醒】
目标市场、平台、风格倾向是后续广告派生阶段的预留上下文，本步只用于理解用户 brief，不得把它们写入商品视觉身份，不得用它们推断图片中看不到的商品功能、材质、使用场景或人群。
（图片见附件）
"""


def format_spec_prompt(brief: Brief, previous_error: str | None = None) -> str:
    prompt = (
        SPEC_EXTRACTOR_PROMPT.replace("{name}", brief.name)
        .replace("{selling_points}", brief.selling_points)
        .replace("{brand_tone}", brief.brand_tone)
        .replace("{material_hint}", brief.material_hint or "（未提供）")
        .replace("{target_markets}", "、".join(brief.target_markets))
        .replace("{platform}", brief.platform)
        .replace("{style_preference}", brief.style_preference)
    )
    if previous_error:
        prompt += (
            "\n\n【上一次输出未通过校验】\n"
            f"{previous_error}\n"
            "请只修正 JSON 结构、字段类型和字段内容，仍然不要输出任何 JSON 以外的文字。"
        )
    return prompt


def build_anchor_block(spec: ProductSpec) -> str:
    """Build the non-negotiable visual identity prefix for every generation prompt.

    使用连贯的自然语言描述（而非 "字段: 值" 的规格表），因为主流图像/视频生成工具
    （Midjourney、即梦/Dreamina、可灵/Kling 等）对流畅的描述性语句解析效果更好，
    而对逐行标签式的规格清单支持较差。商品字段值保留中文原文（gpt-image-2 原生支持
    中日韩文字，即梦/可灵本就偏好中文），色值以通用 hex 呈现。"""
    visual = spec.visual_anchor
    clauses = [spec.anchor_sentence.rstrip("。.")]

    color_clause = f"其主色为{visual.primary_color.name}（{visual.primary_color.hex}）"
    if visual.secondary_colors:
        color_clause += "，辅以" + "、".join(
            f"{color.name}（{color.hex}）" for color in visual.secondary_colors
        )
    clauses.append(color_clause)
    clauses.append(f"材质为{visual.material}")
    clauses.append(f"整体呈{visual.silhouette}，{visual.proportions}")
    marking = visual.brand_marking
    if marking.mark_type == "wordmark":
        clauses.append(
            f"{marking.application_method}呈现的文字品牌标识“{marking.text_content}”位于"
            f"{marking.position}，视觉表现为{marking.appearance}"
        )
    elif marking.mark_type == "graphic_mark":
        clauses.append(
            f"{marking.application_method}呈现的图形品牌标识位于{marking.position}，"
            f"图案为{marking.graphic_description}，视觉表现为{marking.appearance}"
        )
    elif marking.mark_type == "combined_mark":
        clauses.append(
            f"{marking.application_method}呈现的图文品牌标识位于{marking.position}，"
            f"文字为“{marking.text_content}”，图案为{marking.graphic_description}，"
            f"视觉表现为{marking.appearance}"
        )
    elif marking.mark_type == "none":
        clauses.append("商品表面没有品牌文字、图形徽标或装饰性商标")
    else:
        clauses.append(f"{marking.position}存在不可读的品牌标识，外观为{marking.appearance}")
    if visual.distinctive_details:
        clauses.append("并保留" + "、".join(visual.distinctive_details))
    description = "；".join(c for c in clauses if c) + "。"

    lines = [
        "PRODUCT ANCHOR — reproduce this exact product identically in every shot, do not restyle or alter it:",
        description,
    ]
    taboos = "、".join(spec.visual_taboos)
    if taboos:
        lines.append(f"Never depict: {taboos}.")
    if marking.mark_type == "none":
        marking_instruction = "Do not add any brand name, logo, badge, or trademark to the product."
    elif marking.mark_type == "wordmark" and marking.preservation_level == "required":
        marking_instruction = (
            f'Reproduce the exact wordmark "{marking.text_content}" at the stated position. '
            "If exact text cannot be rendered, do not replace it with invented text or a graphic."
        )
    elif marking.mark_type == "unreadable" or marking.preservation_level == "omit_if_unclear":
        marking_instruction = "Do not invent readable brand text or substitute an unrelated logo."
    else:
        marking_instruction = "Keep the product's brand marking type, content, position, and finish as described above."
    lines.append(
        "Keep the product's parts, colors and materials exactly as described above; "
        "do not add, remove, or replace any of them."
    )
    lines.append(marking_instruction)
    return "\n".join(lines)


def build_creative_safe_spec_view(spec: ProductSpec) -> dict[str, Any]:
    """构造派生模型可见的「净室」Spec 视图，只保留非视觉字段。

    A/B 两臂共用同一段 creative_direction（见 derivation_retry._build_prompt_artifact），
    Arm B 只是在它前面多拼一个 anchor_block。因此只要 direction 的作者看过 visual_anchor，
    对照组就可能夹带视觉信息，「有无锚点」这个唯一变量就不干净了。

    这里从输入构造上切断该路径：派生模型看不到任何视觉身份字段，商品外观只经由
    build_anchor_block 进入 Arm B。对照组的纯净性因此来自结构，而不是事后靠
    find_anchor_leaks 做字符串匹配去拦——后者只拦得住原文相同的词，拦不住英文改写与语义泄漏。

    one_line 一并排除：它虽然只描述外观与品类，但含轮廓信息（如「高挑直筒形」），
    与 visual_anchor.silhouette 同源。
    """
    return {
        "product_identity": {
            "name": spec.product_identity.name,
            "category": spec.product_identity.category,
        },
        "selling_points": [point.model_dump() for point in spec.selling_points],
        "brand_tone": list(spec.brand_tone),
    }


def format_derivation_prompt(
    spec: ProductSpec,
    context: DerivationContext,
    previous_error: str | None = None,
) -> str:
    market_rules = "\n".join(
        "\n".join(
            [
                f"【{market}】",
                f"- 输出语言：{MARKET_LOCALIZATION_POLICIES[market]['language']}",
                f"- 场景与选角：{MARKET_LOCALIZATION_POLICIES[market]['scene']}",
                f"- 卖点切入：{MARKET_LOCALIZATION_POLICIES[market]['angle']}",
                f"- 表达风格：{MARKET_LOCALIZATION_POLICIES[market]['direction']}",
                f"- 合规/禁忌：{MARKET_LOCALIZATION_POLICIES[market]['compliance']}",
            ]
        )
        for market in context.target_markets
    )
    style_directive = STYLE_DIRECTIVES.get(
        context.style_preference,
        f"按“{context.style_preference}”风格表达：据此确定色调、光线、场景氛围与镜头语言。",
    )
    markets_literal = "、".join(f"「{market}」" for market in context.target_markets)
    safe_spec_json = json.dumps(
        build_creative_safe_spec_view(spec), ensure_ascii=False, indent=2
    )

    prompt = f"""你是资深海外效果广告创意策略师。基于已确认的商品信息，为每个选中市场生成一套 15 秒短视频广告创意。

【唯一数据源】
下面的信息已经由用户确认。卖点与品牌调性只能来自这里；不要补充这里不存在的功能、认证、价格、折扣、人物或场景事实。
{safe_spec_json}

【商品外观：不在你的职责范围内（最高优先级，违反必须重写）】
上面的信息**刻意不包含商品外观**（颜色、材质、造型、比例、品牌标识、独特细节）。商品在画面里长什么样，由系统在你输出之后自动拼接的固定锚点决定，不归你负责。
- 你没有看过商品图，也没有拿到任何外观描述。禁止猜测、编造或暗示商品的颜色、材质、形状、尺寸、表面细节、logo 文字或图案——写错了会直接污染成片。
- image_prompt_draft / video_prompt_draft / 分镜 visual 里，商品一律用中性指代（the product），只写场景、人物、动作、光线、构图、镜头运动与氛围。
- Hook / 正文 / CTA / 屏显文案 / 配音同样不得描写商品外观，只从卖点与品牌调性切入。

【本次派生上下文】
- 平台：{context.platform}
- 素材风格倾向：{context.style_preference}
- 风格的具体视觉含义（必须落实到画面）：{style_directive}
- 选中市场：{'、'.join(context.target_markets)}

【各市场本地化要求】
{market_rules}

【差异化硬性要求（最高优先级，违反必须重写）】
商品和卖点相同，但不同市场的创意必须明显不同，不能只是换语言换措辞：
- 每个市场的【第 1 镜】必须直接发生在该市场“场景与选角”所描述的具体场景中。例如：东南亚必须是家庭/多人/炎热气候下的出行（摩托通勤、市集、户外）等生活化场景；日本必须是狭小整洁的居家/通勤/桌面场景；韩国必须是潮流咖啡馆/街头/社交分享场景；欧洲必须是极简住宅/安静日常。
- 【严禁通用模板】：除非市场场景本就如此（仅美国），否则禁止使用“年轻人在健身房/独自在都市跑步/健身长凳上的水杯”这类通用运动生活方式画面。若你发现多个市场都写成了跑步/健身，说明没有做本地化，必须重写。
- 每个市场的首镜 Hook 和主推卖点要贴合该市场“卖点切入”，不同市场从不同卖点切入（如东南亚主打耐用/性价比/炎热保冷，日本主打精致小巧，韩国主打设计即时尚），不要都按 selling_points 原顺序平铺。
- 【风格必须落地，且优先级高于场景默认色彩】：image_prompt_draft / video_prompt_draft 里必须显式包含“风格的具体视觉含义”中的关键词（色调、光线、场景质感、氛围）——这些词只描述场景与打光，不得转用于描写商品本身的材质或颜色。风格指令与市场场景的默认色彩冲突时，风格指令优先——例如“简约高级”要求低饱和/克制配色，即使该市场场景本身色彩丰富（如热闹市集），也必须表现为压低饱和度、简化背景、克制光线，不得输出 vivid colors / warm sunlight 这类与“低饱和克制”矛盾的词；“科技未来”必须出现 cool tones / neon / metallic / futuristic cityscape 等词，绝不能输出 warm sunlight 的通用画面；“清新治愈”必须是柔光低对比。风格不同，画面必须肉眼可区分。
- 自检：把不同市场的第 1 镜并排看，场景与人物应一眼不同；把不同风格的 image_prompt 并排看，色调氛围应一眼不同；尤其检查风格关键词有没有被场景默认色彩盖过。若雷同或矛盾，重写。

【任务】
为每个选中市场恰好输出 1 套创意。
- 【market 字段特别规则，最容易出错，务必注意】：market 字段的值必须是下面这几个中文字符串中的一个，逐字符原样输出，禁止翻译成英文或任何其它语言，禁止意译（例如选中市场是"东南亚"，market 字段就必须输出"东南亚"这两个汉字，不能写成 "Southeast Asia"）：{markets_literal}
- 市场覆盖：不得遗漏、重复或额外增加市场，输出的 market 集合必须与上面列表完全相同。

每套创意必须包括：
1. 本地语言的 Hook、正文文案、CTA，并各自提供准确简洁的中文释义。
2. 3-4 个连续分镜，总时长严格等于 15 秒。每镜写清视觉动作、本地语言屏显文案与配音，并附中文释义。第 1 镜必须在前 3 秒出现 Hook。
3. image_prompt_draft：用于生成单张关键广告画面的英文 Prompt。只写构图、场景、光线、镜头、人物/道具、品牌调性与屏显文案；不要写商品锚点，因为系统会自动加入固定锚点。
4. video_prompt_draft：用于生成 15 秒广告视频的英文 Prompt。要覆盖分镜节奏、镜头运动、场景、声音/字幕提示与 CTA；同样不要写商品锚点。

【硬规则】
- Hook / body_copy / CTA / on_screen_copy / voiceover 必须使用该市场指定语言，不得出现翻译腔；对应的 _zh 字段写中文释义。
- image_prompt_draft 与 video_prompt_draft 一律用英文，屏显文字和配音可在引号中保留本地语言原文。
- 卖点只能取自 selling_points；不要把外观特征伪装成产品功能，也不要把“可投放、爆款、高转化”等主观判断写成事实。
- 遵守该市场的合规边界。
- 风格倾向只决定画面表达（色调、光线、氛围、镜头语言），不得用来描写商品本身。
- 请输出符合 JSON Schema 的合法 JSON，不要输出任何解释性文字。
"""
    if previous_error:
        prompt += (
            "\n【上一次输出未通过校验】\n"
            f"{previous_error}\n"
            "请修正市场覆盖、字段类型、分镜编号或总时长；仍只输出合规 JSON。"
        )
    return prompt
