# 持续交付记录

本文档记录 72 小时比赛开发过程中的 commit 与 Pull Request。比赛要求强调“全周期持续交付”，因此本仓库从第一版 MVP 后开始采用功能分支和 PR 记录开发过程，并保持 `main` 分支可运行。

## 1. 当前仓库状态

| 项目 | 内容 |
| --- | --- |
| 仓库 | `https://github.com/JuieZhao/ai-voice-drawing-tool` |
| 主分支 | `main` |
| 当前策略 | 每个后续能力通过独立分支和 PR 合入 |
| 仓库可见性 | 开发期 private，提交评审前/评审期按要求改为 public 或确保评委可访问 |
| 本地验证 | `npm run check`、`npm run dev`、`npm run static` |

## 2. 提交原则

1. `main` 分支保持可运行状态。
2. 每个明确功能点单独创建分支。
3. 每个分支至少包含一个有意义的 commit。
4. 每个阶段通过 PR 记录设计、实现、验证和取舍。
5. 不在最后一天一次性导入大段代码。
6. PR 合并前必须说明验证方式，至少包含 `npm run check`。
7. 语音、绘图、Prompt、文档类修改尽量拆成不同 PR，避免一个 PR 过大。
8. 若后续引入第三方库、历史代码或外部素材，必须在 README 和 PR 描述中说明来源与用途。

## 3. 分支命名

| 类型 | 格式 | 示例 |
| --- | --- | --- |
| 功能 | `feature/<name>` | `feature/command-parser-v2` |
| 文档 | `docs/<name>` | `docs/submission-compliance` |
| 修复 | `fix/<name>` | `fix/speech-permission` |
| 视觉打磨 | `polish/<name>` | `polish/composite-templates` |
| 发布准备 | `release/<name>` | `release/submission-docs` |

## 4. 已完成时间线

| 时间 | 分支 | 提交/PR | 内容 |
| --- | --- | --- | --- |
| 2026-06-12 | `main` | `c59a4de` | 初始化声绘板 MVP：静态页面、Canvas 绘图、语音入口、基础 DSL、组合对象、README 和设计文档 |
| 2026-06-12 | `main` | `ba8ec8d` | 增加 favicon，清理浏览器自动请求的 404 |
| 2026-06-12 | `feature/speech-diagnostics-and-delivery-docs` | `bf8e845` | 增强麦克风权限检测、语音状态提示、错误提示；补充持续交付文档和语音指令能力清单 |
| 2026-06-12 | `feature/speech-diagnostics-and-delivery-docs` | PR `#1` | 合入语音诊断修复和初版持续交付材料 |
| 2026-06-12 | `docs/complete-delivery-documentation` | `d50a715` | 补完整持续交付记录、PR 模板和指令验收脚本 |
| 2026-06-12 | `docs/complete-delivery-documentation` | PR `#2` | 合入完整持续交付文档 |
| 2026-06-12 | `docs/submission-compliance` | PR `#3` | 补齐提交规则、依赖、原创说明、Demo 占位和提交检查清单 |
| 2026-06-12 | `feature/chrome-speech-recognition-stability` | PR `#4` | 增强 Chrome 语音识别候选选择、自动续听和 Edge 提示 |
| 2026-06-12 | `feature/chrome-speech-recognition-stability` | PR `#5` | 抑制 SpeechRecognition network 错误后的自动重试刷屏 |
| 2026-06-12 | `feature/deepseek-llm-parser` | PR `#6` | 增加 DeepSeek 可选复杂口令解析、本地 DSL 过滤和连接状态显示 |
| 2026-06-12 | `feature/composition-grid-codes` | PR `#7` | 增加 A1-C3 坐标格、坐标显示/隐藏和坐标定位口令 |
| 2026-06-12 | `feature/turtle-drawing-planner` | PR `#8` | 增加绘制步骤面板、规划对象和海龟式画笔控制 |
| 2026-06-12 | `fix/cat-layout-and-turtle-paths` | PR `#9` | 去掉组合模板和推荐口令，改为路径笔画、按格距离和上下文继续绘制 |

所有已列 commit 均在本批次开始时间 2026-06-12 00:00 之后产生。

## 5. PR 记录

### PR #1：Improve speech diagnostics and delivery docs

地址：

```text
https://github.com/JuieZhao/ai-voice-drawing-tool/pull/1
```

分支：

```text
feature/speech-diagnostics-and-delivery-docs -> main
```

功能描述：

增强语音识别启动阶段的可见反馈，让用户知道系统是正在请求麦克风权限、正在监听、听到声音、正在识别，还是因为权限、设备或网络原因失败。

实现思路：

1. 使用 `navigator.mediaDevices.getUserMedia({ audio: true })` 预检麦克风权限。
2. 监听 `SpeechRecognition` 的 `onstart`、`onaudiostart`、`onsoundstart`、`onspeechstart`、`onnomatch`、`onerror`、`onend`。
3. 在页面中新增 `speechHint` 状态提示。
4. 增加 README 麦克风排查说明。

测试方式：

```bash
npm run check
python -m http.server 5173
```

人工验证：

1. 打开 `http://localhost:5173`。
2. 点击右上角麦克风按钮。
3. 允许浏览器麦克风权限。
4. 说出“画一个蓝色圆形放在中间”。
5. 如果浏览器支持识别且网络可用，画布应创建蓝色圆形；否则页面应显示具体失败原因。

### PR #2：Complete delivery documentation

地址：

```text
https://github.com/JuieZhao/ai-voice-drawing-tool/pull/2
```

分支：

```text
docs/complete-delivery-documentation -> main
```

功能描述：

补齐比赛持续交付文档、指令验收脚本和 PR 模板，使后续每个 PR 都能按比赛规范描述功能、实现思路和测试方式。

实现思路：

1. 扩展 `docs/development-log.md`，记录当前 PR 流程、时间线、验收标准和后续计划。
2. 扩展 `docs/command-list.md`，加入基础和组合对象验收口令。
3. 新增 `.github/pull_request_template.md`，约束后续 PR 描述结构。
4. 更新 README 项目结构。

测试方式：

```bash
npm run check
```

## 6. 后续计划 PR

| PR | 分支建议 | 目标 | 验收标准 |
| --- | --- | --- | --- |
| PR 10 | `feature/path-context` | 路径上下文增强 | 稳定支持上一笔、末端、左侧、右侧等引用 |
| PR 11 | `feature/curve-tools` | 曲线工具增强 | 支持贝塞尔曲线、圆弧和路径闭合 |
| PR 12 | `feature/export-artwork` | 导出作品 | 支持导出 PNG，便于演示成果 |
| PR 13 | `release/submission-docs` | 提交材料整理 | README、DESIGN、Demo 视频链接完整 |

## 7. 每个 PR 的固定检查清单

PR 创建前：

```bash
npm run check
```

如涉及页面行为，再启动本地服务：

```bash
npm run dev
```

打开：

```text
http://localhost:5173
```

检查内容：

1. 页面能正常打开。
2. 控制台无明显错误。
3. 本 PR 相关功能可以复现。
4. README 或 DESIGN 中记录关键取舍。
5. PR 描述中写清楚标题、功能描述、实现思路和测试方式。

## 8. 推荐 Demo 口令

基础图形：

```text
画一个蓝色圆形放在中间
在它右边画一个红色三角形
把圆形变大一点
把三角形改成黄色
撤销上一步
```

路径笔画与上下文：

```text
向右画一条直线
接着向下画一条曲线
在末端画一个圆
从刚才的圆右边继续画直线
用画笔画一个正方形
用画笔画一个三角形
落笔
向前走一百
向右转九十度
```

最终场景目标：

```text
向右画一条直线，接着向下画一条曲线，再在末端画一个圆
```
