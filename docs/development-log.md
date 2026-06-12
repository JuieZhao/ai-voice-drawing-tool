# 持续交付记录

本文档用于记录 72 小时比赛开发过程中的阶段性工作、提交和 Pull Request。比赛要求强调“全周期持续交付”，因此本仓库从第一版 MVP 后开始采用功能分支和 PR 记录开发过程。

## 1. 当前仓库状态

| 项目 | 内容 |
| --- | --- |
| 仓库 | `JuieZhao/ai-voice-drawing-tool` |
| 主分支 | `main` |
| 当前功能分支 | `feature/speech-diagnostics-and-delivery-docs` |
| 当前 PR | `#1 Improve speech diagnostics and delivery docs` |
| PR 地址 | `https://github.com/JuieZhao/ai-voice-drawing-tool/pull/1` |
| 当前策略 | 保持 `main` 可运行，每个后续能力通过 PR 合入 |

## 2. 提交原则

1. `main` 分支保持可运行状态。
2. 每个明确功能点单独创建分支。
3. 每个分支至少包含一个有意义的 commit。
4. 每个阶段通过 PR 记录设计、实现、验证和取舍。
5. 不在最后一天一次性导入大段代码。
6. PR 合并前必须说明验证方式，至少包含 `npm run check`。
7. 语音、绘图、Prompt、文档类修改尽量拆成不同 PR，避免一个 PR 过大。

## 3. 分支命名

| 类型 | 格式 | 示例 |
| --- | --- | --- |
| 功能 | `feature/<name>` | `feature/llm-dsl-parser` |
| 文档 | `docs/<name>` | `docs/demo-script` |
| 修复 | `fix/<name>` | `fix/speech-permission` |
| 视觉打磨 | `polish/<name>` | `polish/composite-templates` |
| 发布准备 | `release/<name>` | `release/submission-docs` |

## 4. 已完成时间线

| 时间 | 分支 | 提交/PR | 内容 |
| --- | --- | --- | --- |
| 2026-06-12 | `main` | `c59a4de` | 初始化声绘板 MVP：静态页面、Canvas 绘图、语音入口、基础 DSL、组合对象、README 和设计文档 |
| 2026-06-12 | `main` | `ba8ec8d` | 增加 favicon，清理浏览器自动请求的 404 |
| 2026-06-12 | `feature/speech-diagnostics-and-delivery-docs` | `bf8e845` | 增强麦克风权限检测、语音状态提示、错误提示；补充持续交付文档和语音指令能力清单 |
| 2026-06-12 | `feature/speech-diagnostics-and-delivery-docs` | PR `#1` | 首个正式 PR，记录语音诊断修复和持续交付材料 |

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

目标：

1. 修复“点击麦克风后用户不知道是否正在监听”的体验问题。
2. 增加麦克风权限检测和错误提示。
3. 明确 Web Speech API 的浏览器限制和排查路径。
4. 建立持续交付记录和指令能力清单。

验收标准：

| 验收项 | 状态 |
| --- | --- |
| 点击麦克风前有明确提示 | 已完成 |
| 点击麦克风后请求浏览器权限 | 已完成 |
| 权限失败时显示原因 | 已完成 |
| 识别服务网络失败时提示原因 | 已完成 |
| 无声音时有超时提示 | 已完成 |
| README 有麦克风排查说明 | 已完成 |
| docs 有持续交付记录 | 已完成 |
| docs 有指令能力清单 | 已完成 |

验证方式：

```bash
npm run check
python -m http.server 5173
```

浏览器访问：

```text
http://localhost:5173
```

人工验证：

1. 点击右上角麦克风按钮。
2. 浏览器弹窗中允许麦克风权限。
3. 页面提示应进入“正在监听”或“麦克风已开始采集声音”状态。
4. 说出“画一个蓝色圆形放在中间”。
5. 如果浏览器支持识别且网络可用，画布应创建蓝色圆形。
6. 如果识别失败，页面应显示具体失败原因。

## 6. 后续计划 PR

| PR | 分支建议 | 目标 | 验收标准 |
| --- | --- | --- | --- |
| PR 2 | `feature/command-parser-v2` | 指令解析增强 | 多段语音指令、相对位置、对象引用更稳定 |
| PR 3 | `polish/composite-templates` | 组合对象美术打磨 | 太阳、云、树、房子、小女孩风格更统一 |
| PR 4 | `feature/scene-layout` | 复杂场景生成 | 一句话生成小场景并自动布局 |
| PR 5 | `feature/export-artwork` | 导出作品 | 支持导出 PNG，便于演示成果 |
| PR 6 | `release/submission-docs` | 提交材料整理 | README、DESIGN、Demo 脚本和视频说明完整 |

## 7. 每个 PR 的固定检查清单

PR 创建前：

```bash
npm run check
```

如涉及页面行为，再启动本地服务：

```bash
python -m http.server 5173
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
5. PR 描述中写清楚验证方式。

## 8. 推荐 Demo 口令

基础图形：

```text
画一个蓝色圆形放在中间
在它右边画一个红色三角形
把圆形变大一点
把三角形改成黄色
撤销上一步
```

组合对象：

```text
在右上角画一个太阳
画两朵云
下面画一棵树
左边画一座房子
画一个小女孩
```

最终场景目标：

```text
画一个小女孩站在房子旁边，天上有太阳和云，右边有一棵树
```

## 9. 当前未合入内容

当前 `main` 分支还没有包含 PR #1 的语音诊断修复和文档补充。原因是为了保留完整 PR 流程记录。

合入 PR #1 后，`main` 将包含：

1. 麦克风权限检测。
2. 语音状态提示。
3. Web Speech API 失败原因提示。
4. 指令能力清单。
5. 持续交付记录。
