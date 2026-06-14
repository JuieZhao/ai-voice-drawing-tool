# 设计文档

## 1. 需求理解

比赛议题要求开发一款纯语音控制的绘图工具。用户不能使用鼠标或键盘完成绘图创作，只能通过语音指令驱动画布。

核心评价点包括：

1. 指令理解的准确性与容错性。
2. 语音到绘图操作的响应延迟。
3. 复杂指令的拆解与执行能力。
4. 作品完整度、交互流畅度和创新性。

## 2. 产品定位

本项目定位为一个语音驱动的矢量绘图白板。

它不把语音直接转换成不可编辑图片，而是把语音转换为可执行的绘图 DSL，再由 Canvas 渲染为可继续编辑的图形对象。

## 3. 用户故事

计划支持：

| 用户故事 | 当前状态 |
| --- | --- |
| 用户可以启动语音监听 | 已实现 |
| 用户可以语音绘制基础路径 | 已实现 |
| 用户可以指定颜色、位置和大小 | 已实现 |
| 用户可以使用 A1-C3 坐标格定位对象 | 已实现 |
| 用户可以修改最近创建对象 | 已实现 |
| 用户可以撤销、重做、清空画布 | 已实现 |
| 用户可以一笔一笔画路径 | 已实现初版 |
| 用户可以一句话生成多个对象 | 部分实现 |
| 用户可以通过 OpenAI 解析复杂指令 | 可选实现 |
| 用户可以查看路径动作的绘制步骤 | 已实现初版 |
| 用户可以用上一笔、末端、它等上下文继续绘制 | 已实现初版 |
| 用户可以像海龟绘图一样逐步控制画笔 | 已实现初版 |
| 用户可以导出 PNG / SVG | 待实现 |

## 4. 系统架构

```text
浏览器前端
  ├─ Web Speech API 语音识别
  ├─ 本地规则指令解析器
  ├─ 可选 OpenAI 指令解析器
  ├─ 绘图 DSL
  ├─ 路径笔画解析器
  ├─ 海龟式画笔状态
  ├─ Canvas 渲染器
  ├─ 对象状态管理
  ├─ 撤销 / 重做栈
  └─ 执行日志

Node 本地服务
  ├─ 静态资源服务
  ├─ /api/llm-status
  └─ /api/llm-command -> OpenAI Responses API
```

## 5. 绘图 DSL

项目使用两层安全表示来表达绘图动作：

1. 复杂物体优先使用受限 `turtleCode`，让 LLM 像写 Python turtle 一样描述运笔。
2. 执行层只接受结构化 JSON actions；前端会把 `turtleCode` 白名单解析成这些 actions，再交给 Canvas 渲染。

示例：

```json
{
  "turtleCode": null,
  "actions": [
    {"type": "draw_path", "path": "circle", "radiusGridUnits": 2, "anchor": "cursor"}
  ]
}
```

复杂物体示例：

```json
{
  "plan": ["从当前指针开始画五角星"],
  "actions": null,
  "turtleCode": "pendown()\nfor _ in range(5):\n    forward(170)\n    right(144)",
  "clarification": null
}
```

前端不会执行 Python 代码，只会解析 `forward`、`left/right`、`goto`、`circle`、`dot`、`color`、`pensize`、`begin_fill/end_fill` 和简单 `for range` 等受限语句。

当前支持的动作：

- `move_cursor`
- `draw_path`
- `update_object`
- `resize_object`
- `move_object`
- `delete_object`
- `undo`
- `redo`
- `clear_canvas`
- `pen_down`
- `pen_up`
- `turtle_forward`
- `turtle_turn`
- `turtle_goto` / `goto`
- `turtle_set_heading` / `set_heading`
- `turtle_circle` / `circle`
- `turtle_arc` / `arc`
- `turtle_python_circle`（由 `turtleCode` 的 `circle(radius, extent)` 转换而来）
- `turtle_home`
- `turtle_color`
- `turtle_width`
- `fill_start`
- `fill_end`
- `set_grid`

路径型 DSL 可以额外带 `plan` 字段，用于解释画笔动作的拆解过程：

```json
{
  "plan": ["向右画一条直线", "从上一笔末端向下画曲线", "在末端画圆"],
  "actions": [
    {"type": "draw_path", "path": "line", "direction": "right", "distance": 120, "anchor": "cursor"},
    {"type": "draw_path", "path": "curve", "direction": "down", "distance": 100, "anchor": "last_end"},
    {"type": "draw_path", "path": "circle", "radius": 42, "anchor": "last_end"}
  ]
}
```

对于本地兜底配方和精细位置控制，项目仍支持 turtle-like 局部 DSL。局部坐标以本次口令开始时的指针为原点，`gridX` 向右为正，`gridY` 向上为正：

```json
{
  "plan": ["用当前指针作为狗脸中心", "画脸、耳朵和五官"],
  "actions": [
    {"type": "fill_start", "fill": "#f8d9a8"},
    {"type": "circle", "radiusGridUnits": 1.7, "stroke": "#1f2937", "strokeWidth": 4},
    {"type": "fill_end"},
    {"type": "goto", "gridX": -1.05, "gridY": 1.05},
    {"type": "circle", "radiusGridUnits": 0.5, "stroke": "#1f2937", "fill": "#92400e"},
    {"type": "goto", "gridX": 0, "gridY": -0.55},
    {"type": "arc", "radiusGridUnits": 0.42, "startAngle": 200, "extent": 140}
  ]
}
```

## 6. 指令理解策略

当前 MVP 采用“本地规则优先 + OpenAI 可选增强”的混合解析策略，优先保证低延迟、可控性和 Demo 稳定性。

解析流程：

```text
中文语音文本
  -> 清理空格和标点
  -> 判断系统命令
  -> 拆分多段指令
  -> 识别颜色、位置、大小、坐标格、路径类型和上下文锚点
  -> 生成受限 turtleCode 或绘图 DSL
  -> 执行动作
```

OpenAI 保留为可选增强：复杂自然语言优先交给模型生成受限 `turtleCode`，再由前端安全翻译成结构化 actions。三天比赛演示中，稳定目标保留本地高质量运笔配方兜底，未预制物体再交给 OpenAI 尝试拆成运笔步骤。

对于三天比赛版，完整物体不追求开放世界自动规划，而是采用“LLM turtleCode 规划 + 本地兜底动作配方”的混合策略：小猫、小狗、小房子、小花、小树等演示目标会被展开成 `goto`、`circle`、`arc`、`draw_path` 和 `turtle_turn` 等基础动作。它不是贴图模板，画布仍然会显示指针一步步绘制。

为降低语音描述位置的难度，画布默认显示 A1-C3 九宫格辅助线。用户既可以说“左上角、右边、下面”等自然方位，也可以说“在 B2 画一个圆”“把它移到 C3”。坐标格只作为构图辅助，不改变画布对象模型；画面上不直接显示 A1/B2 标签，避免干扰作品观感。

画布上的细网格同时承担距离单位：1 格 = 34 像素。用户说“向右画一个五格长的直线”时，解析器会生成 `gridUnits: 5`，执行层再换算成实际像素距离。这样用户不需要理解像素，也能像写 turtle 代码一样精确控制笔画长度。

指针朝向也是上下文的一部分：0 度向右，顺时针为正角度。用户可以说“顺时针旋转45度”“逆时针旋转15度”，之后再说“向前画五格”或“向前移动三格”，执行层会沿当前指针方向绘制或移动。

对“五角星、矩形、三角形、小猫、小狗、小房子”等稳定演示目标，系统可以使用本地动作配方直接展开为可执行 DSL，避免 LLM 偶发算错角度或部件位置。对未预制的小物体，系统优先让 OpenAI 规划路径动作，并用本地白名单过滤，失败时再回退到澄清提示。

## 7. Prompt 设计

OpenAI 系统 Prompt 采用以下原则：

```text
你是一个语音绘图指令解析器。你的任务是把用户的中文语音指令转换为绘图操作 JSON。

规则：
1. 只能输出 JSON，不要输出解释。
2. 复杂物体、动物、房子、花、树、车、五角星优先输出 turtleCode，actions 设为 null。
3. 撤销、重做、清空、移动指针等控制命令输出 actions，turtleCode 设为 null。
4. 如果用户说“它”“刚才那个”“这个”，优先引用最近创建或最近选中的对象。
5. 如果目标对象无法确定，返回 clarification 字段，向用户提出一个简短问题。
6. 不要输出贴图、组合模板或 `create_shape`；复杂对象也必须拆成路径动作。
7. turtleCode 只能使用受限 Python turtle 子集，不要输出 import、函数、变量、条件、while 或任意 Python。
8. 所有图形默认使用 cute_flat 风格。
```

实现约束：

1. API Key 只保存在本地服务端环境变量或 `.env`，不会暴露给浏览器。
2. OpenAI 输出必须经过前端 `turtleCode` / DSL 白名单过滤，只允许执行已支持动作。
3. 默认模型为 `gpt-5.4-mini`，如需更强理解可配置为 `gpt-5.5`。
4. 后端使用 Responses API 和 JSON Schema 约束输出结构，减少无效 DSL。
5. 默认 `OPENAI_MAX_OUTPUT_TOKENS=6000`，防止复杂简笔画 JSON 输出被截断。

## 8. 审美系统

项目采用儿童绘本式扁平矢量贴纸风。

视觉规则：

- 深色统一描边
- 明亮柔和配色
- 圆角和柔和曲线
- 少量阴影
- 不追求真实照片感，追求清晰、可爱、可编辑

## 9. 路径与上下文策略

当前版本主动撤掉组合模板，避免作品变成“语音贴纸工具”。系统把每一笔都记录为可编辑对象，并为它维护中心、边界和末端等上下文锚点。

系统采用 turtle-like 的思想，但实现上不直接依赖 Python turtle。核心链路是：

```text
自然语言 -> 受限 turtleCode / 绘图 DSL -> Canvas 路径对象 -> 可继续引用的上下文
```

关键上下文包括：

- 当前指针/起笔点位置和方向。
- 最近一笔的末端。
- 最近对象的中心、左侧、右侧、上侧、下侧。
- 最近对象引用：“它”“刚才那个”“上一笔”。

典型链式口令：

```text
向右画一条直线
指针向下移动五格
向右画一个五格长的直线
顺时针旋转45度
向前画五格
画一个五角星，边长五格
接着向下画一条曲线
在末端画一个圆
从刚才的圆右边继续画直线
```

## 10. 海龟式画笔

为了解决“只会放库里的形状”的局限，项目新增了海龟式画笔状态：

- 画笔位置：使用画布归一化坐标保存。
- 画笔方向：0 度向右，顺时针旋转为正角度。
- 指针移动：支持“指针向下移动五格”，只改变起笔点，不留下线条。
- 指针旋转：支持“顺时针旋转45度”“逆时针旋转15度”，后续 `forward` 会沿当前朝向执行。
- 落笔状态：落笔时移动会生成线条，抬笔时只移动光标。
- 画笔属性：支持颜色和线宽。
- 局部定位：支持 `goto`，用相对本次口令起点的局部坐标移动画笔。
- 圆形路径：支持 `circle`，以当前指针为圆心画圆。
- 圆弧路径：支持 `arc`，以当前指针为圆心画指定角度的圆弧。
- Python turtle 圆：`turtleCode` 中的 `circle(radius, extent)` 会按 Python turtle 语义转换为 Canvas 圆弧。
- 填充控制：支持 `fill_start` / `fill_end`，给后续闭合路径填色。
- 路径预设：支持“用画笔画正方形 / 三角形”，自动拆成落笔、前进、转向、抬笔动作。
- 受限代码解析：支持 `forward`、`backward`、`left/right`、`goto`、`setheading`、`circle`、`dot`、`color`、`pensize`、`begin_fill/end_fill` 和简单 `for range`。

典型口令：

```text
落笔
向前走一百
顺时针旋转九十度
再向前走六十
抬笔
回到中心
用画笔画一个正方形
用画笔画一个三角形
画一个小狗
```

这个能力让用户可以逐步“教”系统画路径，也为 LLM 把复杂轮廓拆成路径动作提供基础。

## 11. 延迟优化

当前版本使用本地规则解析，不依赖网络模型，因此常用指令响应很快。

接入 LLM 后使用混合策略：

1. 简单命令本地解析。
2. 复杂指令调用 OpenAI。
3. LLM 输出必须经过 `turtleCode` / DSL 白名单过滤，不能 `eval` 或执行任意 Python。
4. 解析失败时降级为澄清问题或简化版本。

## 12. 未完成部分与原因

| 功能 | 原因 |
| --- | --- |
| PNG / SVG 导出 | MVP 优先验证语音绘图闭环 |
| 更丰富路径类型 | turtle-like 圆弧已实现初版，贝塞尔曲线和更复杂闭合路径仍需继续扩展 |
| 任意物体自动规划 | 需要 LLM 稳定输出 turtleCode、构图关系和笔画顺序，当前先用有限运笔配方保证 Demo |
| 语音澄清对话 | 需要更完整的对话状态管理 |
| 更强上下文选择 | 需要区分“上一条线”“左边的圆”“最近的曲线”等目标 |

## 13. 后续优化方向

1. 增强 LLM 解析复杂自然语言。
2. 扩展受限 turtleCode / `draw_path`，支持贝塞尔曲线，并继续增强圆弧和路径闭合。
3. 支持导出作品。
4. 支持语音确认和语音澄清。
5. 增加对象选择能力，例如“选择上一条曲线”。
6. 增加自动构图，使复杂路径组合更美观。
7. 让 LLM 针对任意物体稳定输出“绘制步骤 + turtleCode + 指针动作”，逐步替代有限运笔配方。
