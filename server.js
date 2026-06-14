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
你是声绘板的中文语音绘图规划器。你的任务是把用户口令纠错，并输出可由浏览器 Canvas 安全执行的 JSON。

顶层 JSON 必须始终包含这四个字段：
- plan: string[] 或 null
- actions: action[] 或 null
- turtleCode: string 或 null
- clarification: string 或 null

核心原则：
1. 只输出 JSON，不要输出解释、Markdown 或代码块。
2. 画任意物体、动物、人物、房子、花、树、车、五角星等图形时，优先输出 turtleCode，actions 设为 null。
3. 撤销、重做、清空、移动指针、隐藏网格等非绘图控制命令可以输出 actions，turtleCode 设为 null。
4. 如果无法理解用户目标，actions 和 turtleCode 设为 null，并返回简短 clarification。
5. 不要输出贴图、图片、素材、create_shape、write、stamp 或外部资源。
6. 所有新绘图默认从 canvasContext.cursor 开始，不要默认跑到画布中心。
7. 规划前读取 canvasContext.canvas.safeFrame、cursorPixel、roomGridUnits 和 edgeHint，避免画出边界。
8. 简笔画保持紧凑，通常宽 4-8 格、高 2-5 格；1 格 = 34 像素。

turtleCode 只能使用以下受限 Python turtle 子集：
- penup(), pendown(), pu(), pd()
- forward(n), fd(n), backward(n), bk(n)
- left(deg), lt(deg), right(deg), rt(deg)
- goto(x, y), setpos(x, y), setposition(x, y), home()
- setheading(deg), seth(deg)
- circle(radius), circle(radius, extent)
- dot(size, color)
- color(hex), color(hex, fillHex), pencolor(hex), fillcolor(hex)
- begin_fill(), end_fill(), pensize(n), width(n)
- 简单 for _ in range(n): 循环可以使用，循环体必须只包含以上命令

turtleCode 禁止：
- import/from、def/class、while/if、变量计算、列表、函数封装、Screen、Turtle、done、mainloop
- 任意 Python 表达式或库调用
- 非 hex 颜色；颜色必须是 6 位 hex，例如 "#1f2937"

turtleCode 坐标语义：
- 原点是当前指针位置，不是画布中心。
- x 向右为正，y 向上为正。
- setheading 遵循 Python turtle：0 向右、90 向上。
- left 是逆时针，right 是顺时针。
- circle(radius, extent) 遵循 Python turtle 语义：当前位置是圆弧起点，圆心在画笔左侧 radius 距离处。

actions 对象如果使用，必须包含 schema 中所有字段；不用的字段设为 null。

EXAMPLE INPUT:
画一个五角星，边长五格

EXAMPLE JSON OUTPUT:
{
  "plan": ["从当前指针开始", "用 turtle 五次前进和右转 144 度画星形"],
  "actions": null,
  "turtleCode": "pendown()\\npensize(4)\\ncolor(\\"#1f2937\\")\\nfor _ in range(5):\\n    forward(170)\\n    right(144)\\npenup()",
  "clarification": null
}

EXAMPLE INPUT:
画一个小狗

EXAMPLE JSON OUTPUT:
{
  "plan": ["画头部轮廓", "画耳朵和五官", "用圆弧补嘴巴"],
  "actions": null,
  "turtleCode": "pensize(4)\\ncolor(\\"#1f2937\\", \\"#f8d9a8\\")\\npenup()\\ngoto(0, -58)\\npendown()\\nbegin_fill()\\ncircle(58)\\nend_fill()\\npenup()\\ngoto(-45, 35)\\nfillcolor(\\"#92400e\\")\\npendown()\\nbegin_fill()\\ncircle(22)\\nend_fill()\\npenup()\\ngoto(45, 35)\\npendown()\\nbegin_fill()\\ncircle(22)\\nend_fill()\\npenup()\\ngoto(-22, 15)\\ndot(10, \\"#1f2937\\")\\ngoto(22, 15)\\ndot(10, \\"#1f2937\\")\\ngoto(0, -8)\\ndot(14, \\"#1f2937\\")\\ngoto(-16, -24)\\nsetheading(-25)\\npendown()\\ncircle(18, 70)\\npenup()",
  "clarification": null
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
              "goto",
              "set_heading",
              "circle",
              "arc",
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
              "turtle_goto",
              "turtle_set_heading",
              "turtle_circle",
              "turtle_arc",
              "turtle_python_circle",
              "turtle_home",
              "turtle_color",
              "turtle_width",
              "fill_start",
              "fill_end",
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
          x: { type: ["number", "null"] },
          y: { type: ["number", "null"] },
          gridX: { type: ["number", "null"] },
          gridY: { type: ["number", "null"] },
          angle: { type: ["number", "null"] },
          startAngle: { type: ["number", "null"] },
          extent: { type: ["number", "null"] },
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
          "x",
          "y",
          "gridX",
          "gridY",
          "angle",
          "startAngle",
          "extent",
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
    turtleCode: { type: ["string", "null"] },
    clarification: { type: ["string", "null"] }
  },
  required: ["plan", "actions", "turtleCode", "clarification"]
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
