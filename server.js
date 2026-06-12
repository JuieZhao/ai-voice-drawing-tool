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
3. 只能使用当前支持的动作、图形、组合对象、位置和 target。
4. 如果一句话包含多个对象或动作，请拆成 actions 数组。
5. 遇到“它、刚才那个、旁边、右边、左边”等上下文，优先使用 target:"last_created" 和 relativeTo。
6. 新建相互关联的场景时，先创建锚点对象，再让后续对象 relativeTo last_created。
7. 颜色必须输出 6 位 hex，例如 "#60a5fa"。
8. size 使用 48 到 280 之间的数字。
9. 如果无法映射到当前能力，返回简短 clarification。
10. 用户要求“像海龟一样画、落笔、前进、转向、画笔颜色/粗细”时，使用 turtle actions。
11. 用户要求画一个完整物体但没有现成组合对象时，先在 plan 里说明步骤，再拆成基础图形动作。
12. create_shape 可以使用 width、height 和 strokeWidth 微调椭圆、扁圆、细线等部件。

支持的 actions：
- create_shape: shape 为 circle, rect, triangle, line, arrow, text
- create_composite: object 为 sun, cloud, tree, house, flower, girl
- update_object, resize_object, move_object, delete_object, undo, redo, clear_canvas, set_grid
- pen_down, pen_up, turtle_forward, turtle_turn, turtle_home, turtle_color, turtle_width

支持的位置：
center, left, right, top, bottom, top_left, top_right, bottom_left, bottom_right, A1, B1, C1, A2, B2, C2, A3, B3, C3

EXAMPLE INPUT:
落笔，向前走一百，右转九十度，再向前走六十

EXAMPLE JSON OUTPUT:
{
  "plan": ["落下画笔", "前进 100 像素", "右转 90 度", "前进 60 像素"],
  "actions": [
    {"type":"pen_down"},
    {"type":"turtle_forward","distance":100},
    {"type":"turtle_turn","angle":90},
    {"type":"turtle_forward","distance":60}
  ]
}

EXAMPLE INPUT:
画一个小女孩站在房子旁边，天上有太阳和云，右边有一棵树

EXAMPLE JSON OUTPUT:
{
  "plan": ["先画房子作为场景锚点", "把小女孩放在房子旁边", "在天空补太阳和云", "在右边补一棵树"],
  "actions": [
    {"type":"create_composite","object":"house","fill":"#fde68a","position":"bottom_left","size":190},
    {"type":"create_composite","object":"girl","fill":"#f9a8d4","relativeTo":{"target":"last_created","placement":"right"},"size":190},
    {"type":"create_composite","object":"sun","fill":"#facc15","position":"top_right","size":96},
    {"type":"create_composite","object":"cloud","fill":"#f8fafc","position":"top","size":130},
    {"type":"create_composite","object":"tree","fill":"#34d399","position":"bottom_right","size":170}
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
