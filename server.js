import { createReadStream, existsSync, readFileSync } from "node:fs";
import { stat } from "node:fs/promises";
import { createServer } from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";

const rootDir = path.dirname(fileURLToPath(import.meta.url));
const maxBodyBytes = 64 * 1024;

const contentTypes = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".txt": "text/plain; charset=utf-8"
};

function loadDotEnv() {
  const envPath = path.join(rootDir, ".env");
  if (!existsSync(envPath)) return;

  const lines = readFileSync(envPath, "utf8").split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const separator = trimmed.indexOf("=");
    if (separator === -1) continue;
    const key = trimmed.slice(0, separator).trim();
    const rawValue = trimmed.slice(separator + 1).trim();
    const value = rawValue.replace(/^["']|["']$/g, "");
    if (key && process.env[key] === undefined) {
      process.env[key] = value;
    }
  }
}

loadDotEnv();

const port = Number(process.env.PORT || 5173);

function cleanApiKey(value) {
  const key = String(value || "").trim();
  if (!key || key.includes("replace-with") || key.includes("你的")) return "";
  return key;
}

function cleanReasoningEffort(value) {
  const effort = String(value || "low").trim().toLowerCase();
  return ["none", "low", "medium", "high", "xhigh"].includes(effort) ? effort : "low";
}

function cleanMaxOutputTokens(value) {
  const tokens = Number(value);
  return Number.isFinite(tokens) ? Math.min(Math.max(Math.round(tokens), 1200), 12000) : 6000;
}

const providerConfig = {
  provider: process.env.LLM_PROVIDER || "OpenAI",
  apiKey: cleanApiKey(process.env.OPENAI_API_KEY || process.env.LLM_API_KEY),
  baseUrl: process.env.OPENAI_BASE_URL || process.env.LLM_BASE_URL || "https://api.openai.com/v1",
  model: process.env.OPENAI_MODEL || process.env.LLM_MODEL || "gpt-5.4-mini",
  reasoningEffort: cleanReasoningEffort(process.env.OPENAI_REASONING_EFFORT || process.env.LLM_REASONING_EFFORT),
  maxOutputTokens: cleanMaxOutputTokens(process.env.OPENAI_MAX_OUTPUT_TOKENS || process.env.LLM_MAX_OUTPUT_TOKENS)
};

const commandSystemPrompt = `
你是声绘板的中文语音绘图指令解析器。你的任务是把用户口令纠错并转换成可执行的绘图 DSL json。

必须遵守：
1. 只输出 json，不要输出解释、Markdown 或代码块。
2. 输出格式只能是 {"actions":[...]}、{"plan":[...],"actions":[...]} 或 {"clarification":"..."}。
3. 只能使用当前支持的动作、路径、位置和 target。
4. 如果一句话包含多个对象或动作，请拆成 actions 数组。
5. 遇到“它、刚才那个、旁边、右边、左边”等上下文，优先使用 target:"last_created" 和 relativeTo。
6. 新建相互关联的场景时，先创建锚点对象，再让后续对象 relativeTo last_created。
7. 颜色必须输出 6 位 hex，例如 "#60a5fa"。
8. size 使用 48 到 280 之间的数字。
9. 如果无法映射到当前能力，返回简短 clarification。
10. 用户要求“像海龟一样画、落笔、前进、转向、画笔颜色/粗细”时，使用 turtle actions。
11. 不要输出贴图、图片、素材、组合模板或 create_shape。复杂对象必须拆成基础笔画和路径。
12. draw_path 用于一笔一笔画：path 为 line、curve、circle，可设置 direction、distance、radius、anchor。
13. 矩形、三角形、五角星、简笔画都必须展开成 draw_path、move_cursor、turtle_turn 等动作，不能作为一个形状对象放到画布上。
14. 画布细网格是距离单位，1 格 = 34 像素。用户说“五格长”时优先输出 gridUnits:5，而不是 distance:5。
15. 用户要求“指针/光标/笔尖移动”时，使用 move_cursor。move_cursor 只移动起笔点，不留下线条；后续 draw_path 默认从 cursor 开始。
16. 指针有方向：0 度向右，顺时针为正角度。用户说“顺时针旋转45度/逆时针旋转15度/向右转90度”时输出 turtle_turn。direction:"forward" 必须沿当前指针方向移动或绘制。
17. 用户要求画任意物体、几何图案或简笔画时，你是“运笔规划器”：根据目标外形推理怎么下笔、怎么移动、怎么转向，再输出可执行 actions。
18. 复杂简笔画可以用圆形路径、短直线、斜线、曲线和指针移动组合，但每一步必须是当前 DSL 支持的 action。
19. 不要输出 repeat/loop 语法、部件名或纯文字计划；必须把所有步骤展开成实际 actions。
20. 除非用户明确说“移到中心 / 在 B2 / 在左上角”等绝对位置，所有新绘图都必须从 canvasContext.cursor 开始规划；不要默认跑到画布中间。
21. draw_path 不要使用 position 字段，始终使用 anchor:"cursor" 或 anchor:"last_end"。如果确实要换绝对位置，先输出 move_cursor，再继续 draw_path。
22. 用户说“画一个小狗/小猫/房子/花/树”等物体时，先在 plan 中写清楚部件顺序，再把它展开成实际 move_cursor、draw_path、turtle_turn 或 turtle_forward 动作，像写 turtle 代码一样一步步画。
23. 简笔画动作要克制：plan 不超过 6 条，actions 优先控制在 30 步以内，避免输出过长导致 JSON 被截断。
24. 规划物体前必须读取 canvasContext.canvas：其中包含 width、height、safeFrame、cursorPixel、roomGridUnits 和 edgeHint。所有笔画尽量留在 safeFrame 内。
25. 如果 cursor.roomGridUnits 显示某个方向少于 4 格，说明指针靠近边缘；不要继续朝该边缘扩展，要把物体主体画向剩余空间更大的方向。
26. 对小汽车、小动物等紧凑物体，宽度通常控制在 4-8 格，高度 2-5 格；优先输出 gridUnits，不要输出很大的 distance。
27. draw_path circle 的 anchor:"cursor" 表示当前指针是圆心；圆画完后运行时指针会落在圆右侧，所以连续画多个圆前要先 move_cursor 到下一个圆心。

支持的 actions：
- move_cursor: direction 为 left, right, up, down, forward；可用 gridUnits 表示移动几格，也可用 position 移到固定位置
- draw_path: path 为 line, curve, circle；direction 为 left, right, up, down, forward；forward 会沿当前指针朝向；也可用 angle 指定绝对角度；anchor 只能为 cursor 或 last_end；可用 gridUnits 表示直线/曲线长度，用 radiusGridUnits 表示圆半径
- update_object, resize_object, move_object, delete_object, undo, redo, clear_canvas, set_grid
- pen_down, pen_up, turtle_forward, turtle_turn, turtle_home, turtle_color, turtle_width
- turtle_turn: angle 为正数表示顺时针旋转，负数表示逆时针旋转

支持的位置：
center, left, right, top, bottom, top_left, top_right, bottom_left, bottom_right, A1, B1, C1, A2, B2, C2, A3, B3, C3

EXAMPLE INPUT:
落笔，向前走一百，顺时针旋转九十度，再向前走六十

EXAMPLE JSON OUTPUT:
{
  "plan": ["落下画笔", "前进 100 像素", "顺时针旋转 90 度", "前进 60 像素"],
  "actions": [
    {"type":"pen_down"},
    {"type":"turtle_forward","distance":100},
    {"type":"turtle_turn","angle":90},
    {"type":"turtle_forward","distance":60}
  ]
}

EXAMPLE INPUT:
向右画一条直线，接着向下画一条曲线，再在末端画一个圆

EXAMPLE JSON OUTPUT:
{
  "plan": ["向右画一条直线", "从上一笔末端向下画曲线", "在当前末端画圆"],
  "actions": [
    {"type":"draw_path","path":"line","direction":"right","gridUnits":4,"anchor":"cursor","stroke":"#1f2937","strokeWidth":4},
    {"type":"draw_path","path":"curve","direction":"down","distance":100,"anchor":"last_end","stroke":"#1f2937","strokeWidth":4},
    {"type":"draw_path","path":"circle","radius":42,"anchor":"last_end","stroke":"#1f2937","strokeWidth":4}
  ]
}

EXAMPLE INPUT:
指针向下移动五格，然后向右画一条三格长的直线

EXAMPLE JSON OUTPUT:
{
  "plan": ["指针向下移动 5 格", "从指针位置向右画 3 格直线"],
  "actions": [
    {"type":"move_cursor","direction":"down","gridUnits":5},
    {"type":"draw_path","path":"line","direction":"right","gridUnits":3,"anchor":"cursor","stroke":"#1f2937","strokeWidth":4}
  ]
}

EXAMPLE INPUT:
顺时针旋转45度，然后向前画五格

EXAMPLE JSON OUTPUT:
{
  "plan": ["指针顺时针旋转 45 度", "沿当前朝向向前画 5 格直线"],
  "actions": [
    {"type":"turtle_turn","angle":45},
    {"type":"draw_path","path":"line","direction":"forward","gridUnits":5,"anchor":"cursor","stroke":"#1f2937","strokeWidth":4}
  ]
}

EXAMPLE INPUT:
画一个五角星，边长五格

EXAMPLE JSON OUTPUT:
{
  "plan": ["每条边向前画 5 格", "每画完一条边顺时针旋转 144 度", "重复展开 5 条边"],
  "actions": [
    {"type":"draw_path","path":"line","direction":"forward","gridUnits":5,"anchor":"cursor","stroke":"#1f2937","strokeWidth":4},
    {"type":"turtle_turn","angle":144},
    {"type":"draw_path","path":"line","direction":"forward","gridUnits":5,"anchor":"cursor","stroke":"#1f2937","strokeWidth":4},
    {"type":"turtle_turn","angle":144},
    {"type":"draw_path","path":"line","direction":"forward","gridUnits":5,"anchor":"cursor","stroke":"#1f2937","strokeWidth":4},
    {"type":"turtle_turn","angle":144},
    {"type":"draw_path","path":"line","direction":"forward","gridUnits":5,"anchor":"cursor","stroke":"#1f2937","strokeWidth":4},
    {"type":"turtle_turn","angle":144},
    {"type":"draw_path","path":"line","direction":"forward","gridUnits":5,"anchor":"cursor","stroke":"#1f2937","strokeWidth":4},
    {"type":"turtle_turn","angle":144}
  ]
}
`.trim();

const dslResponseSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    plan: {
      type: ["array", "null"],
      items: { type: "string" }
    },
    actions: {
      type: ["array", "null"],
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          type: {
            type: "string",
            enum: [
              "move_cursor",
              "draw_path",
              "update_object",
              "resize_object",
              "move_object",
              "delete_object",
              "undo",
              "redo",
              "clear_canvas",
              "pen_down",
              "pen_up",
              "turtle_forward",
              "turtle_turn",
              "turtle_home",
              "turtle_color",
              "turtle_width",
              "set_grid"
            ]
          },
          path: { type: ["string", "null"], enum: ["line", "curve", "circle", null] },
          direction: { type: ["string", "null"], enum: ["left", "right", "up", "down", "forward", null] },
          stroke: { type: ["string", "null"] },
          fill: { type: ["string", "null"] },
          strokeWidth: { type: ["number", "null"] },
          distance: { type: ["number", "null"] },
          radius: { type: ["number", "null"] },
          gridUnits: { type: ["number", "null"] },
          radiusGridUnits: { type: ["number", "null"] },
          angle: { type: ["number", "null"] },
          anchor: { type: ["string", "null"], enum: ["cursor", "last_end", null] },
          target: { type: ["string", "null"], enum: ["last_created", "circle", "rect", "triangle", "line", "arrow", "text", "stroke", null] },
          position: {
            type: ["string", "null"],
            enum: [
              "center",
              "left",
              "right",
              "top",
              "bottom",
              "top_left",
              "top_right",
              "bottom_left",
              "bottom_right",
              "A1",
              "B1",
              "C1",
              "A2",
              "B2",
              "C2",
              "A3",
              "B3",
              "C3",
              null
            ]
          },
          updates: {
            type: ["object", "null"],
            additionalProperties: false,
            properties: {
              fill: { type: ["string", "null"] }
            },
            required: ["fill"]
          },
          scale: { type: ["number", "null"] },
          visible: { type: ["boolean", "null"] },
          width: { type: ["number", "null"] }
        },
        required: [
          "type",
          "path",
          "direction",
          "stroke",
          "fill",
          "strokeWidth",
          "distance",
          "radius",
          "gridUnits",
          "radiusGridUnits",
          "angle",
          "anchor",
          "target",
          "position",
          "updates",
          "scale",
          "visible",
          "width"
        ]
      }
    },
    clarification: { type: ["string", "null"] }
  },
  required: ["plan", "actions", "clarification"]
};

function openAiResponsesUrl(baseUrl) {
  const trimmed = String(baseUrl || "").replace(/\/+$/, "");
  if (trimmed.endsWith("/responses")) return trimmed;
  return `${trimmed}/responses`;
}

function openAiRequestBody(text, context) {
  return {
    model: providerConfig.model,
    instructions: commandSystemPrompt,
    input: [
      {
        role: "user",
        content: [
          {
            type: "input_text",
            text: JSON.stringify({
              voiceText: text,
              canvasContext: context || {}
            })
          }
        ]
      }
    ],
    reasoning: { effort: providerConfig.reasoningEffort },
    text: {
      format: {
        type: "json_schema",
        name: "voice_drawing_dsl",
        strict: true,
        schema: dslResponseSchema
      }
    },
    max_output_tokens: providerConfig.maxOutputTokens,
    store: false
  };
}

function extractOpenAiModelContent(data) {
  if (data?.output_parsed && typeof data.output_parsed === "object") return data.output_parsed;
  if (typeof data?.output_text === "string") return data.output_text;

  const chunks = [];
  for (const item of data?.output || []) {
    for (const part of item?.content || []) {
      if (part?.parsed && typeof part.parsed === "object") return part.parsed;
      if (part?.json && typeof part.json === "object") return part.json;
      if (typeof part?.text === "string") {
        chunks.push(part.text);
      }
    }
  }
  return chunks.join("\n");
}

function sendJson(response, status, payload) {
  response.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store"
  });
  response.end(JSON.stringify(payload));
}

function readJsonBody(request) {
  return new Promise((resolve, reject) => {
    let body = "";

    request.on("data", (chunk) => {
      body += chunk;
      if (Buffer.byteLength(body) > maxBodyBytes) {
        reject(new Error("REQUEST_TOO_LARGE"));
        request.destroy();
      }
    });

    request.on("end", () => {
      try {
        resolve(body ? JSON.parse(body) : {});
      } catch (error) {
        reject(new Error("INVALID_JSON"));
      }
    });

    request.on("error", reject);
  });
}

function stripCodeFence(text) {
  return String(text || "")
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/i, "")
    .trim();
}

function extractJsonObjectText(text) {
  const source = String(text || "");
  const start = source.indexOf("{");
  if (start === -1) return "";

  let depth = 0;
  let inString = false;
  let escaping = false;

  for (let index = start; index < source.length; index += 1) {
    const char = source[index];

    if (escaping) {
      escaping = false;
      continue;
    }

    if (char === "\\") {
      escaping = true;
      continue;
    }

    if (char === "\"") {
      inString = !inString;
      continue;
    }

    if (inString) continue;

    if (char === "{") depth += 1;
    if (char === "}") depth -= 1;

    if (depth === 0) {
      return source.slice(start, index + 1);
    }
  }

  return source.slice(start);
}

function parseModelJson(text) {
  if (text && typeof text === "object") return text;
  const cleaned = stripCodeFence(text);
  try {
    return JSON.parse(cleaned);
  } catch (error) {
    const jsonText = extractJsonObjectText(cleaned);
    if (!jsonText) throw error;
    return JSON.parse(jsonText);
  }
}

async function handleLlmCommand(request, response) {
  if (request.method !== "POST") {
    sendJson(response, 405, { error: "METHOD_NOT_ALLOWED" });
    return;
  }

  if (!providerConfig.apiKey) {
    sendJson(response, 503, {
      error: "LLM_NOT_CONFIGURED",
      message: "请先配置 OPENAI_API_KEY 或 LLM_API_KEY。"
    });
    return;
  }

  let payload;
  try {
    payload = await readJsonBody(request);
  } catch (error) {
    sendJson(response, 400, { error: error.message });
    return;
  }

  const text = String(payload.text || "").trim();
  if (!text) {
    sendJson(response, 400, { error: "EMPTY_COMMAND" });
    return;
  }

  const requestBody = openAiRequestBody(text, payload.context || {});

  let apiResponse;
  try {
    apiResponse = await fetch(openAiResponsesUrl(providerConfig.baseUrl), {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${providerConfig.apiKey}`
      },
      body: JSON.stringify(requestBody)
    });
  } catch (error) {
    sendJson(response, 502, {
      error: "LLM_NETWORK_ERROR",
      message: error.message
    });
    return;
  }

  const raw = await apiResponse.text();
  let data = {};
  try {
    data = raw ? JSON.parse(raw) : {};
  } catch (error) {
    sendJson(response, 502, {
      error: "LLM_BAD_RESPONSE",
      message: "模型服务返回了不可解析内容。"
    });
    return;
  }

  if (!apiResponse.ok) {
    sendJson(response, apiResponse.status, {
      error: data.error?.code || data.error?.type || "LLM_API_ERROR",
      message: data.error?.message || "模型服务请求失败。"
    });
    return;
  }

  if (data.status === "incomplete") {
    sendJson(response, 502, {
      error: "LLM_OUTPUT_INCOMPLETE",
      message: data.incomplete_details?.reason === "max_output_tokens"
        ? "模型输出被截断，请调高 OPENAI_MAX_OUTPUT_TOKENS 或让指令更短。"
        : "模型输出未完成，请重试。"
    });
    return;
  }

  const content = extractOpenAiModelContent(data);
  if (typeof content === "string" && !content.trim()) {
    sendJson(response, 502, {
      error: "LLM_EMPTY_CONTENT",
      message: "模型没有返回可执行 JSON。"
    });
    return;
  }

  try {
    sendJson(response, 200, {
      provider: providerConfig.provider,
      model: providerConfig.model,
      dsl: parseModelJson(content)
    });
  } catch (error) {
    sendJson(response, 502, {
      error: "LLM_JSON_PARSE_ERROR",
      message: "模型返回的 JSON 解析失败。",
      snippet: typeof content === "string" ? content.slice(0, 240) : ""
    });
  }
}

function handleLlmStatus(response) {
  sendJson(response, 200, {
    provider: providerConfig.provider,
    configured: Boolean(providerConfig.apiKey),
    baseUrl: providerConfig.baseUrl,
    model: providerConfig.model,
    reasoningEffort: providerConfig.reasoningEffort,
    maxOutputTokens: providerConfig.maxOutputTokens
  });
}

async function serveStatic(request, response, pathname) {
  const rawPath = pathname === "/" ? "/index.html" : pathname;
  const decoded = decodeURIComponent(rawPath);
  const filePath = path.normalize(path.join(rootDir, decoded));
  const relative = path.relative(rootDir, filePath);

  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    response.writeHead(403);
    response.end("Forbidden");
    return;
  }

  try {
    const fileStat = await stat(filePath);
    if (!fileStat.isFile()) throw new Error("NOT_FILE");
  } catch (error) {
    response.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
    response.end("Not found");
    return;
  }

  const ext = path.extname(filePath).toLowerCase();
  response.writeHead(200, {
    "Content-Type": contentTypes[ext] || "application/octet-stream",
    "Cache-Control": "no-store"
  });
  createReadStream(filePath).pipe(response);
}

const server = createServer(async (request, response) => {
  const url = new URL(request.url || "/", `http://${request.headers.host || "localhost"}`);

  if (url.pathname === "/api/llm-status") {
    handleLlmStatus(response);
    return;
  }

  if (url.pathname === "/api/llm-command") {
    await handleLlmCommand(request, response);
    return;
  }

  await serveStatic(request, response, url.pathname);
});

server.listen(port, () => {
  console.log(`VoxCanvas dev server running at http://localhost:${port}`);
  console.log(`${providerConfig.provider} parser: ${providerConfig.apiKey ? "configured" : "not configured"} (${providerConfig.model})`);
});
