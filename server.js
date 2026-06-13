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

function cleanThinkingMode(value) {
  const mode = String(value || "disabled").trim().toLowerCase();
  return ["enabled", "disabled", "off"].includes(mode) ? mode : "disabled";
}

const providerConfig = {
  provider: process.env.LLM_PROVIDER || "DeepSeek",
  apiKey: cleanApiKey(process.env.DEEPSEEK_API_KEY || process.env.LLM_API_KEY),
  baseUrl: process.env.DEEPSEEK_BASE_URL || process.env.LLM_BASE_URL || "https://api.deepseek.com",
  model: process.env.DEEPSEEK_MODEL || process.env.LLM_MODEL || "deepseek-v4-flash",
  thinking: cleanThinkingMode(process.env.DEEPSEEK_THINKING || process.env.LLM_THINKING)
};

const commandSystemPrompt = `
你是声绘板的中文语音绘图指令解析器。你的任务是把用户口令纠错并转换成可执行的绘图 DSL json。

必须遵守：
1. 只输出 json，不要输出解释、Markdown 或代码块。
2. 输出格式只能是 {"actions":[...]}、{"plan":[...],"actions":[...]} 或 {"clarification":"..."}。
3. 只能使用当前支持的动作、基础图形、路径、位置和 target。
4. 如果一句话包含多个对象或动作，请拆成 actions 数组。
5. 遇到“它、刚才那个、旁边、右边、左边”等上下文，优先使用 target:"last_created" 和 relativeTo。
6. 新建相互关联的场景时，先创建锚点对象，再让后续对象 relativeTo last_created。
7. 颜色必须输出 6 位 hex，例如 "#60a5fa"。
8. size 使用 48 到 280 之间的数字。
9. 如果无法映射到当前能力，返回简短 clarification。
10. 用户要求“像海龟一样画、落笔、前进、转向、画笔颜色/粗细”时，使用 turtle actions。
11. 不要输出贴图、图片、素材或组合模板。复杂对象也必须拆成基础笔画、路径和基础图形。
12. draw_path 用于一笔一笔画：path 为 line、curve、circle，可设置 direction、distance、radius、anchor。
13. create_shape 只用于必要的基础图形，不用于太阳、云、树、房子、小女孩等模板对象。
14. 画布细网格是距离单位，1 格 = 34 像素。用户说“五格长”时优先输出 gridUnits:5，而不是 distance:5。
15. 用户要求“指针/光标/笔尖移动”时，使用 move_cursor。move_cursor 只移动起笔点，不留下线条；后续 draw_path 默认从 cursor 开始。
16. 指针有方向：0 度向右，顺时针为正角度。用户说“顺时针旋转45度/逆时针旋转15度/向右转90度”时输出 turtle_turn。direction:"forward" 必须沿当前指针方向移动或绘制。

支持的 actions：
- move_cursor: direction 为 left, right, up, down, forward；可用 gridUnits 表示移动几格，也可用 position 移到固定位置
- draw_path: path 为 line, curve, circle；direction 为 left, right, up, down, forward；forward 会沿当前指针朝向；anchor 为 cursor, last_end, center, left, right, top, bottom；可用 gridUnits 表示直线/曲线长度，用 radiusGridUnits 表示圆半径
- create_shape: shape 为 circle, rect, triangle, line, arrow, text
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
`.trim();

function chatCompletionsUrl(baseUrl) {
  const trimmed = String(baseUrl || "").replace(/\/+$/, "");
  if (trimmed.endsWith("/chat/completions")) return trimmed;
  return `${trimmed}/chat/completions`;
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

function parseModelJson(text) {
  const cleaned = stripCodeFence(text);
  try {
    return JSON.parse(cleaned);
  } catch (error) {
    const match = cleaned.match(/\{[\s\S]*\}/);
    if (!match) throw error;
    return JSON.parse(match[0]);
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
      message: "请先配置 DEEPSEEK_API_KEY 或 LLM_API_KEY。"
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

  const requestBody = {
    model: providerConfig.model,
    messages: [
      { role: "system", content: commandSystemPrompt },
      {
        role: "user",
        content: JSON.stringify({
          voiceText: text,
          canvasContext: payload.context || {}
        })
      }
    ],
    response_format: { type: "json_object" },
    stream: false,
    max_tokens: 900
  };

  if (providerConfig.thinking !== "off") {
    requestBody.thinking = { type: providerConfig.thinking };
  }

  let apiResponse;
  try {
    apiResponse = await fetch(chatCompletionsUrl(providerConfig.baseUrl), {
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

  const content = data.choices?.[0]?.message?.content || "";
  if (!content.trim()) {
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
      message: "模型返回的 JSON 解析失败。"
    });
  }
}

function handleLlmStatus(response) {
  sendJson(response, 200, {
    provider: providerConfig.provider,
    configured: Boolean(providerConfig.apiKey),
    baseUrl: providerConfig.baseUrl,
    model: providerConfig.model,
    thinking: providerConfig.thinking
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
