# 声绘板 VoxCanvas

声绘板是一个纯语音控制的矢量绘图工具。用户启动语音监听后，可以不用鼠标和键盘，通过中文语音创建、修改、移动、删除画布对象。

本项目对应比赛议题二：AI 语音绘图工具。

## 提交信息

| 项目 | 内容 |
| --- | --- |
| 比赛议题 | 题目二：AI 语音绘图工具 |
| 代码仓库 | `https://github.com/JuieZhao/ai-voice-drawing-tool` |
| Demo 视频 | 待录制后补充可访问链接 |
| 持续交付记录 | 见 `docs/development-log.md` |
| 指令能力清单 | 见 `docs/command-list.md` |
| 提交检查清单 | 见 `docs/submission-checklist.md` |

## 核心思路

项目主线不是“语音文生图”，而是：

```text
语音输入 -> 语音识别 -> 指令解析 -> 绘图 DSL -> Canvas 渲染 -> 语音继续编辑
```

AI 与 Prompt 工程的重点在于把自然语言转成稳定、可执行、可校验的绘图动作。当前 MVP 不再走“语音贴模板”的路线，而是先把直线、曲线、圆、画笔移动和上下文引用做好；复杂口令可选接入 DeepSeek，把纠错后的中文口令转换为绘图 DSL。

当前绘图主线是“一笔一笔画”。用户可以说“向右画一条直线”“接着向下画一条曲线”“在末端画一个圆”，系统会记录上一笔的末端、中心和边界，让下一句命令能接着上一句继续画。

它的交互模型接近 Python turtle，但不是直接调用 turtle 库：用户用自然语言描述动作，系统把它转成 `draw_path` / turtle-like DSL，再由 Canvas 在画布上逐步呈现。

## 当前能力

- 语音创建基础图形：圆形、矩形、三角形、线条、箭头、文字
- 语音设置颜色、大小和位置
- 支持 A1-C3 九宫格坐标定位和网格显示/隐藏；细网格也是距离单位，1 格 = 34 像素
- 支持“刚才那个”“它”“上一笔”“末端”等上下文引用
- 支持直接移动指针：指针移动不留下线条，下一次绘图会从新指针位置开始
- 支持一笔一笔画：直线、曲线、圆形路径
- 支持按格绘制距离：“向右画一个五格长的直线”
- 支持相对位置：“从刚才的圆右边继续画直线”
- 支持撤销、重做、清空画布
- 支持绘制步骤面板：展示路径或画笔动作的拆解过程
- 支持海龟式画笔控制：落笔、抬笔、前进、后退、左转、右转、回中心、改画笔颜色、改线宽，并可辅助绘制正方形、三角形
- 支持可选 DeepSeek 复杂口令解析，失败时自动回退本地规则
- 展示最近一次绘图 DSL 和执行日志
- 统一儿童绘本式扁平矢量风格

## 推荐演示口令

```text
向右画一条直线
指针向下移动五格
向右画一个五格长的直线
接着向下画一条曲线
在末端画一个圆
画一个半径六十的圆
从刚才的圆右边继续画直线
隐藏坐标
显示坐标
用画笔画一个正方形
用画笔画一个三角形
落笔
向前走一百
向右转九十度
换成红色
撤销上一步
清空画布
```

## 本地运行

默认开发服务使用 Node.js，既托管静态页面，也提供可选的 DeepSeek 解析接口。

```bash
npm run dev
```

然后打开：

```text
http://localhost:5173
```

如果只想运行不带 LLM 的静态版本：

```bash
npm run static
```

语音识别依赖浏览器 Web Speech API，建议使用 Chrome。

## DeepSeek Key 配置

项目不会在浏览器前端暴露 API Key。Key 只由本地 Node 服务读取。

临时配置 PowerShell 环境变量：

```powershell
$env:DEEPSEEK_API_KEY="你的 DeepSeek API Key"
$env:DEEPSEEK_MODEL="deepseek-v4-flash"
npm run dev
```

也可以在本地新建 `.env` 记录配置，但不要提交 `.env`：

```text
DEEPSEEK_API_KEY=你的 DeepSeek API Key
DEEPSEEK_BASE_URL=https://api.deepseek.com
DEEPSEEK_MODEL=deepseek-v4-flash
DEEPSEEK_THINKING=disabled
```

DeepSeek 官方 API 使用 OpenAI-compatible 格式。当前默认模型使用 `deepseek-v4-flash`；如需更强解析可改为 `deepseek-v4-pro`。旧模型名 `deepseek-chat` 和 `deepseek-reasoner` 官方标注会在 2026-07-24 15:59 UTC 废弃，因此不作为默认值。

## 依赖与第三方说明

当前版本没有引入第三方前端框架、组件库或绘图库，核心功能由本仓库代码实现。

运行时使用的浏览器能力：

- Canvas API：绘制基础图形和路径笔画
- Web Speech API：浏览器语音识别
- MediaDevices `getUserMedia`：麦克风权限检测
- 可选 DeepSeek API：复杂口令纠错与绘图 DSL 生成

开发/验证工具：

- Node.js：本地开发服务、DeepSeek 代理接口、语法检查
- Python `http.server`：可选静态服务

原创功能部分：

- 中文语音指令解析
- 绘图 DSL 设计
- Canvas 渲染器
- 对象状态、撤销、重做
- 路径笔画、上下文锚点和画笔状态
- 语音诊断与错误提示
- DeepSeek 解析提示词、DSL 过滤和本地规则回退逻辑

本项目未复用个人过去项目代码片段；如后续引入第三方库、外部素材或历史代码，将在 README 和对应 PR 描述中注明来源与用途。

## 麦克风排查

如果点击麦克风后没有反应，按下面顺序检查：

1. 使用 Chrome 打开 `http://localhost:5173` 或 `http://127.0.0.1:5173`。
2. 不要使用 `http://[::]:5173` 作为演示地址，部分浏览器可能不会把它当成可靠的本地安全上下文。
3. 点击右上角麦克风按钮后，允许浏览器麦克风权限。
4. 检查 Windows 系统输入设备是否选中了正确麦克风。
5. 如果页面提示网络不可达，说明浏览器内置 SpeechRecognition 服务不可用；后续可切换到云端 ASR。

当前版本已经内置麦克风权限检测、语音采集状态、无声音提示和错误提示。

## 项目结构

```text
.
├─ favicon.svg
├─ index.html
├─ server.js
├─ .env.example
├─ src/
│  ├─ app.js
│  └─ styles.css
├─ docs/
│  ├─ command-list.md
│  └─ development-log.md
├─ README.md
├─ DESIGN.md
└─ package.json
```

## 设计取舍

本项目没有把“生成漂亮图片”作为核心，因为题目考察的是纯语音控制绘图、指令理解、响应延迟和复杂指令拆解。

因此当前版本选择：

- 简单命令走本地解析，保证低延迟。
- 复杂命令可选走 DeepSeek 解析，保证自然语言理解上限。
- LLM 输出必须经过本地 DSL 过滤，不能直接执行模型返回内容。
- 先把基础笔画、路径和上下文做好，而不是预制大量可贴放对象。
- LLM 输出必须是可执行 DSL，优先生成 `draw_path`、海龟动作和基础图形。
- 当前主动收窄复杂物体能力，避免作品变成语音贴纸工具。

## 持续交付

比赛要求全周期持续 PR 和 commit。当前仓库使用如下流程：

1. `main` 始终保持可运行。
2. 每个功能从独立分支开发。
3. 每个 PR 只做一件事，并在 PR 描述中写明功能描述、实现思路和测试方式。
4. PR 合并后再从最新 `main` 开下一个分支。
5. 详细记录见 `docs/development-log.md`。

## 后续计划

- 增加 JSON Schema 校验
- 扩展 `draw_path`，支持贝塞尔曲线、圆弧和路径闭合
- 加强上下文选择，例如“选择上一条曲线”“从圆的左侧开始”
- 支持导出 PNG / SVG
- 增加语音确认与澄清流程
