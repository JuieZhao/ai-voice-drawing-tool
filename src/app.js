const canvas = document.querySelector("#drawingCanvas");
const ctx = canvas.getContext("2d");
const listenButton = document.querySelector("#listenButton");
const speechStatus = document.querySelector("#speechStatus");
const transcriptText = document.querySelector("#transcriptText");
const speechHint = document.querySelector("#speechHint");
const logList = document.querySelector("#logList");
const layerList = document.querySelector("#layerList");
const dslOutput = document.querySelector("#dslOutput");
const objectCount = document.querySelector("#objectCount");
const actionCount = document.querySelector("#actionCount");
const headingValue = document.querySelector("#headingValue");
const planList = document.querySelector("#planList");

const palette = {
  red: "#f87171",
  blue: "#60a5fa",
  yellow: "#facc15",
  green: "#34d399",
  pink: "#f9a8d4",
  purple: "#a78bfa",
  black: "#1f2937",
  white: "#f8fafc",
  orange: "#fb923c",
  brown: "#a16207",
  gray: "#94a3b8"
};

const colorWords = [
  ["红", "red"],
  ["蓝", "blue"],
  ["兰", "blue"],
  ["篮", "blue"],
  ["黄", "yellow"],
  ["绿", "green"],
  ["录", "green"],
  ["粉", "pink"],
  ["紫", "purple"],
  ["黑", "black"],
  ["白", "white"],
  ["橙", "orange"],
  ["棕", "brown"],
  ["灰", "gray"]
];

const gridUnit = 34;
const gridColumns = ["A", "B", "C"];
const gridRows = ["1", "2", "3"];
const gridCells = gridColumns.flatMap((column) => gridRows.map((row) => `${column}${row}`));
const supportedShapes = ["circle", "rect", "triangle", "line", "arrow", "text"];
const supportedTargets = ["last_created", ...supportedShapes, "stroke"];
const supportedPositions = ["center", "left", "right", "top", "bottom", "top_left", "top_right", "bottom_left", "bottom_right", ...gridCells];
const supportedPlacements = ["left", "right", "top", "bottom"];
const supportedActions = [
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
];
const llmComplexPattern = /和|同时|一起|旁边|站在|天上|天空|地上|背景|场景|右边有|左边有|上面有|下面有|前面|后面|附近|周围|然后|再|并且/;

const state = {
  objects: [],
  history: [],
  redo: [],
  lastObjectId: null,
  actionTotal: 0,
  latestDsl: {},
  latestPlan: [],
  turtle: initialTurtle(),
  recognition: null,
  listening: false,
  recognitionActive: false,
  micReady: false,
  silenceTimer: null,
  resultTimer: null,
  restartTimer: null,
  speechStarted: false,
  stopRequested: false,
  lastFinalText: "",
  lastResultAt: 0,
  networkErrorCount: 0,
  lastNetworkErrorAt: 0,
  compositionGridVisible: true,
  drawCursor: { active: false, x: 0.5, y: 0.5 },
  llmAvailable: null,
  llmInFlight: false,
  llmProvider: ""
};

function uid(prefix = "obj") {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function wait(ms) {
  return new Promise((resolve) => {
    window.setTimeout(resolve, ms);
  });
}

function initialTurtle() {
  return {
    x: 0.5,
    y: 0.5,
    angle: 0,
    penDown: false,
    stroke: "#1f2937",
    strokeWidth: 4
  };
}

function normalizeSpeechText(text) {
  let output = String(text || "")
    .trim()
    .replace(/[，。！？、,.!?;；:：\s]/g, "");

  const replacements = [
    [/^(花|化|华)(?=(一|个|两|二|三|四|五|出|上|下|左|右|大|小|条|根|朵|座|只))/, "画"],
    [/兰色|篮色|蓝涩/g, "蓝色"],
    [/洪色|虹色/g, "红色"],
    [/录色|路色/g, "绿色"],
    [/原形|圆型|园形|圆行|原型/g, "圆形"],
    [/圈圈/g, "圆形"],
    [/三角型|三角行/g, "三角形"],
    [/长房形|长方型/g, "长方形"],
    [/正房形|正方型/g, "正方形"],
    [/巨型|举行/g, "矩形"],
    [/剪头/g, "箭头"],
    [/太杨/g, "太阳"],
    [/云多/g, "云朵"],
    [/房屋|小屋子/g, "房子"],
    [/女孩子|小女还/g, "小女孩"],
    [/上一步|上一部|上1步/g, "上一步"],
    [/撤消|取消上一步|返回上一步|退一步/g, "撤销"],
    [/从做|重新做/g, "重做"],
    [/清除全部|全部清除|全部删除|清屏/g, "清空"],
    [/左面|左侧/g, "左边"],
    [/右面|右侧|有边|优边/g, "右边"],
    [/上方|顶部/g, "上面"],
    [/下方|底部/g, "下面"]
  ];

  for (const [pattern, replacement] of replacements) {
    output = output.replace(pattern, replacement);
  }

  return output;
}

function hasColorWord(text) {
  const normalized = normalizeSpeechText(text);
  return colorWords.some(([word]) => normalized.includes(word));
}

function commandScore(text) {
  const normalized = normalizeSpeechText(text);
  let score = 0;

  if (!normalized) return score;
  if (/画|写|放|在|把|改|变|移|撤销|重做|清空|删除/.test(normalized)) score += 2;
  if (shapeFromText(normalized) || basicShapeSketchPlanFromText(normalized) || objectSketchRecipeFromText(normalized)) score += 8;
  if (pathKindFromText(normalized)) score += 8;
  if (hasColorWord(normalized)) score += 3;
  if (positionFromText(normalized)) score += 3;
  if (/变大|放大|变小|缩小|改成|换成|移动|移到|删除|撤销|重做|清空/.test(normalized)) score += 5;
  if (/右边|左边|上面|下面|中间|左上|右上|左下|右下/.test(normalized)) score += 3;
  if (/圆|矩形|三角|线|曲线|弧线|箭头/.test(normalized)) score += 4;

  return score;
}

function pickBestTranscript(alternatives) {
  const candidates = alternatives
    .map((text) => ({
      raw: String(text || "").trim(),
      normalized: normalizeSpeechText(text),
      score: commandScore(text)
    }))
    .filter((candidate) => candidate.raw);

  candidates.sort((a, b) => b.score - a.score || b.normalized.length - a.normalized.length);
  return candidates[0] || { raw: "", normalized: "", score: 0 };
}

function snapshot() {
  return JSON.stringify({
    objects: state.objects,
    lastObjectId: state.lastObjectId,
    actionTotal: state.actionTotal,
    latestPlan: state.latestPlan,
    turtle: state.turtle
  });
}

function restore(data) {
  const parsed = JSON.parse(data);
  state.objects = parsed.objects;
  state.lastObjectId = parsed.lastObjectId;
  state.actionTotal = parsed.actionTotal;
  state.latestPlan = parsed.latestPlan || [];
  state.turtle = parsed.turtle || initialTurtle();
}

function pushHistory() {
  state.history.push(snapshot());
  if (state.history.length > 60) {
    state.history.shift();
  }
  state.redo = [];
}

function addLog(message, type = "info") {
  const item = document.createElement("li");
  item.textContent = message;
  if (type === "error") {
    item.classList.add("is-error");
  }
  logList.prepend(item);
  while (logList.children.length > 9) {
    logList.lastElementChild.remove();
  }
}

function setSpeechHint(message, type = "info") {
  speechHint.textContent = message;
  speechHint.classList.toggle("is-warning", type === "warning");
  speechHint.classList.toggle("is-error", type === "error");
}

function setListening(isListening) {
  state.listening = isListening;
  listenButton.classList.toggle("is-listening", isListening);
  speechStatus.classList.toggle("is-listening", isListening);
  speechStatus.textContent = isListening ? "监听中" : "已暂停";
  if (!isListening) {
    clearSilenceTimer();
  }
}

function clearSilenceTimer() {
  if (state.silenceTimer) {
    window.clearTimeout(state.silenceTimer);
    state.silenceTimer = null;
  }
}

function clearResultTimer() {
  if (state.resultTimer) {
    window.clearTimeout(state.resultTimer);
    state.resultTimer = null;
  }
}

function clearRestartTimer() {
  if (state.restartTimer) {
    window.clearTimeout(state.restartTimer);
    state.restartTimer = null;
  }
}

function startSilenceTimer() {
  clearSilenceTimer();
  clearResultTimer();
  state.speechStarted = false;
  state.silenceTimer = window.setTimeout(() => {
    if (state.listening && !state.speechStarted) {
      setSpeechHint("还没有识别到声音。请确认浏览器允许麦克风、系统输入设备正确，并尽量使用 Chrome 打开 http://localhost:5173。", "warning");
      addLog("监听中，但暂未识别到语音", "error");
    }
  }, 7000);
}

function startResultTimer() {
  clearResultTimer();
  state.resultTimer = window.setTimeout(() => {
    if (state.listening && state.speechStarted) {
      setSpeechHint("已经听到声音，但还没有返回文字。请稍等；如果随后出现网络错误，请重新点一次麦克风。", "warning");
      addLog("听到声音，但未返回文字", "error");
    }
  }, 9000);
}

function syncCanvasResolution() {
  const rect = canvas.getBoundingClientRect();
  const ratio = window.devicePixelRatio || 1;
  const nextWidth = Math.max(1, Math.floor(rect.width * ratio));
  const nextHeight = Math.max(1, Math.floor(rect.height * ratio));
  if (canvas.width !== nextWidth || canvas.height !== nextHeight) {
    canvas.width = nextWidth;
    canvas.height = nextHeight;
  }
  ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
}

function resizeCanvas() {
  syncCanvasResolution();
  draw();
}

function canvasSize() {
  const rect = canvas.getBoundingClientRect();
  return { width: rect.width, height: rect.height };
}

function gridCellFromText(text) {
  const normalized = normalizeSpeechText(text)
    .toUpperCase()
    .replace(/Ａ/g, "A")
    .replace(/Ｂ/g, "B")
    .replace(/Ｃ/g, "C")
    .replace(/[一幺]/g, "1")
    .replace(/二|两/g, "2")
    .replace(/三/g, "3");
  const match = normalized.match(/(?:第)?([ABC])(?:列)?([123])(?:格|区|号)?/);
  if (!match) return null;
  return `${match[1]}${match[2]}`;
}

function gridCellToPoint(cell, size) {
  const match = String(cell || "").toUpperCase().match(/^([ABC])([123])$/);
  if (!match) return null;

  const { width, height } = canvasSize();
  const marginX = Math.max(64, size.width / 2 + 24);
  const marginY = Math.max(64, size.height / 2 + 24);
  const col = gridColumns.indexOf(match[1]);
  const row = gridRows.indexOf(match[2]);

  return {
    x: clamp(((col + 0.5) / gridColumns.length) * width, marginX, width - marginX),
    y: clamp(((row + 0.5) / gridRows.length) * height, marginY, height - marginY)
  };
}

function toPoint(position, size = { width: 120, height: 120 }) {
  const { width, height } = canvasSize();
  const marginX = Math.max(64, size.width / 2 + 24);
  const marginY = Math.max(64, size.height / 2 + 24);

  if (typeof position === "object" && position !== null) {
    return {
      x: clamp(position.x * width, marginX, width - marginX),
      y: clamp(position.y * height, marginY, height - marginY)
    };
  }

  const gridPoint = gridCellToPoint(position, size);
  if (gridPoint) return gridPoint;

  const map = {
    center: [0.5, 0.52],
    left: [0.25, 0.52],
    right: [0.75, 0.52],
    top: [0.5, 0.24],
    bottom: [0.5, 0.78],
    top_left: [0.22, 0.24],
    top_right: [0.78, 0.24],
    bottom_left: [0.22, 0.76],
    bottom_right: [0.78, 0.76]
  };
  const [x, y] = map[position] || map.center;
  return {
    x: clamp(x * width, marginX, width - marginX),
    y: clamp(y * height, marginY, height - marginY)
  };
}

function positionFromText(text) {
  const normalized = normalizeSpeechText(text);
  const gridCell = gridCellFromText(normalized);
  if (gridCell) return gridCell;
  if (/左上|左上角/.test(normalized)) return "top_left";
  if (/右上|右上角/.test(normalized)) return "top_right";
  if (/左下|左下角/.test(normalized)) return "bottom_left";
  if (/右下|右下角/.test(normalized)) return "bottom_right";
  if (/中间|中央|中心/.test(normalized)) return "center";
  if (/左边/.test(normalized)) return "left";
  if (/右边/.test(normalized)) return "right";
  if (/上面|天上/.test(normalized)) return "top";
  if (/下面|地上/.test(normalized)) return "bottom";
  return null;
}

function sizeFromText(text, fallback = 120) {
  const normalized = normalizeSpeechText(text);
  if (/很大|巨大|大一点|放大/.test(normalized)) return Math.round(fallback * 1.25);
  if (/很小|小一点|缩小/.test(normalized)) return Math.round(fallback * 0.78);
  if (/小/.test(normalized)) return Math.round(fallback * 0.82);
  if (/大/.test(normalized)) return Math.round(fallback * 1.18);
  return fallback;
}

function colorFromText(text, fallback = "blue") {
  const normalized = normalizeSpeechText(text);
  for (const [word, color] of colorWords) {
    if (normalized.includes(word)) return color;
  }
  return fallback;
}

function shapeFromText(text) {
  const normalized = normalizeSpeechText(text);
  if (/圆|圈/.test(normalized)) return "circle";
  if (/矩形|长方形|正方形|方块|方形|举行|巨型/.test(normalized)) return "rect";
  if (/三角/.test(normalized)) return "triangle";
  if (/箭头|剪头/.test(normalized)) return "arrow";
  if (/线|横线|竖线/.test(normalized)) return "line";
  return null;
}

function pathKindFromText(text) {
  const normalized = normalizeSpeechText(text);
  if (/曲线|弧线|弯线|弯曲/.test(normalized)) return "curve";
  if (/圆|圈/.test(normalized)) return "circle";
  if (/直线|横线|竖线|线段|一条线|画线/.test(normalized)) return "line";
  if (gridCountFromText(normalized) && /画/.test(normalized)) return "line";
  return null;
}

function countFromText(text) {
  const normalized = normalizeSpeechText(text);
  const cn = { 一: 1, 二: 2, 两: 2, 三: 3, 四: 4, 五: 5 };
  const digit = normalized.match(/[1-5]/);
  if (digit) return Number(digit[0]);
  for (const [word, value] of Object.entries(cn)) {
    if (normalized.includes(word)) return value;
  }
  return 1;
}

function numberFromText(text, fallback = null) {
  const normalized = normalizeSpeechText(text);
  const digit = normalized.match(/\d+/);
  if (digit) return Number(digit[0]);

  const token = normalized.match(/[零一幺二两三四五六七八九十百]+/)?.[0] || "";
  const parsed = parseChineseNumberToken(token);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function parseChineseNumberToken(token) {
  const digits = { 零: 0, 一: 1, 幺: 1, 二: 2, 两: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9 };
  const clean = String(token || "").trim();
  if (!clean) return null;
  if (/^\d+$/.test(clean)) return Number(clean);

  const digitChars = [...clean].map((char) => digits[char]);
  if (!/[十百]/.test(clean) && digitChars.every((value) => Number.isFinite(value))) {
    return Number(digitChars.join(""));
  }

  if (clean.includes("百")) {
    const [rawHundreds, rawRest = ""] = clean.split("百");
    const hundreds = rawHundreds ? parseChineseNumberToken(rawHundreds) : 1;
    if (!Number.isFinite(hundreds)) return null;
    const rest = rawRest.replace(/^零/, "");
    if (!rest) return hundreds * 100;
    if (!rest.includes("十") && rest.length === 1 && !rawRest.startsWith("零")) {
      return hundreds * 100 + (digits[rest] || 0) * 10;
    }
    const restValue = parseChineseNumberToken(rest);
    return Number.isFinite(restValue) ? hundreds * 100 + restValue : hundreds * 100;
  }

  if (clean.includes("十")) {
    const [rawTens, rawOnes = ""] = clean.split("十");
    const tens = rawTens ? parseChineseNumberToken(rawTens) : 1;
    const ones = rawOnes ? parseChineseNumberToken(rawOnes) : 0;
    return (Number.isFinite(tens) ? tens : 1) * 10 + (Number.isFinite(ones) ? ones : 0);
  }

  return digits[clean] ?? null;
}

function angleFromText(text, fallback = 90) {
  const normalized = normalizeSpeechText(text);
  const degreeToken = normalized.match(/(\d+|[零一幺二两三四五六七八九十百]+)(?:度|°)/)?.[1];
  if (degreeToken) {
    const parsed = /^\d+$/.test(degreeToken) ? Number(degreeToken) : parseChineseNumberToken(degreeToken);
    if (Number.isFinite(parsed)) return parsed;
  }
  return numberFromText(normalized, fallback);
}

function gridCountFromText(text) {
  const normalized = normalizeSpeechText(text);
  const digitMatch = normalized.match(/(\d+)(?:个)?格/);
  if (digitMatch) return Number(digitMatch[1]);

  const cnMatch = normalized.match(/([一二两三四五六七八九十百]+)(?:个)?格/);
  if (!cnMatch) return null;
  const count = numberFromText(cnMatch[1], null);
  return Number.isFinite(count) ? count : null;
}

function gridDistanceFromText(text) {
  const count = gridCountFromText(text);
  return Number.isFinite(count) ? count * gridUnit : null;
}

function targetFromText(text) {
  const normalized = normalizeSpeechText(text);
  if (/刚才|上一个|它|这个/.test(normalized)) return "last_created";
  if (/线|笔画|路径|曲线|弧线/.test(normalized)) return "stroke";
  if (/圆|圈/.test(normalized)) return "circle";
  if (/矩形|方/.test(normalized)) return "rect";
  if (/三角/.test(normalized)) return "triangle";
  return "last_created";
}

function relativePlacement(text) {
  const normalized = normalizeSpeechText(text);
  if (/右边/.test(normalized)) return "right";
  if (/左边/.test(normalized)) return "left";
  if (/上面/.test(normalized)) return "top";
  if (/下面/.test(normalized)) return "bottom";
  return null;
}

function plannedObjectFromText(text) {
  const normalized = normalizeSpeechText(text);
  if (/汽车|小车|车子|轿车|太阳|云|女孩|小女孩/.test(normalized)) {
    return {
      clarification: "这个目标需要先拆成可执行的画笔步骤。"
    };
  }
  return null;
}

function basicShapeSketchPlanFromText(text) {
  const normalized = normalizeSpeechText(text);
  const stroke = palette[colorFromText(normalized, "black")] || state.turtle.stroke;
  const strokeWidth = pathStrokeWidthFromText(normalized);
  const gridUnits = gridCountFromText(normalized) || 4;
  const line = (units) => ({
    type: "draw_path",
    path: "line",
    direction: "forward",
    gridUnits: units,
    anchor: "cursor",
    stroke,
    strokeWidth
  });
  const turn = (angle) => ({ type: "turtle_turn", angle });

  if (/三角形|三角/.test(normalized)) {
    return {
      plan: [`用 3 条边画三角形，每条边 ${gridUnits} 格`, "每条边后顺时针旋转 120 度"],
      actions: [line(gridUnits), turn(120), line(gridUnits), turn(120), line(gridUnits), turn(120)],
      label: "三角形笔画配方"
    };
  }

  if (/正方形|方块|方形/.test(normalized)) {
    return {
      plan: [`用 4 条边画正方形，每条边 ${gridUnits} 格`, "每条边后顺时针旋转 90 度"],
      actions: [line(gridUnits), turn(90), line(gridUnits), turn(90), line(gridUnits), turn(90), line(gridUnits), turn(90)],
      label: "正方形笔画配方"
    };
  }

  if (/矩形|长方形|举行|巨型/.test(normalized)) {
    const shortSide = Math.max(1, Math.round(gridUnits * 0.62));
    return {
      plan: [`用路径画矩形：长边 ${gridUnits} 格，短边 ${shortSide} 格`, "每条边后顺时针旋转 90 度"],
      actions: [line(gridUnits), turn(90), line(shortSide), turn(90), line(gridUnits), turn(90), line(shortSide), turn(90)],
      label: "矩形笔画配方"
    };
  }

  return null;
}

function starPlanFromText(text) {
  const normalized = normalizeSpeechText(text);
  if (!/五角星|星星|五芒星/.test(normalized)) return null;

  const gridUnits = gridCountFromText(normalized) || 5;
  const actions = [];
  for (let i = 0; i < 5; i += 1) {
    actions.push({
      type: "draw_path",
      path: "line",
      direction: "forward",
      gridUnits,
      anchor: "cursor",
      stroke: state.turtle.stroke,
      strokeWidth: state.turtle.strokeWidth
    });
    actions.push({ type: "turtle_turn", angle: 144 });
  }

  return {
    plan: [
      `画五角星：每条边 ${gridUnits} 格`,
      "重复 5 次：向前画一条边，再顺时针旋转 144 度"
    ],
    actions,
    label: "五角星动作配方"
  };
}

function objectSketchRecipeFromText(text) {
  const normalized = normalizeSpeechText(text);
  if (/狗|小狗|狗狗|小犬/.test(normalized)) return dogSketchRecipeFromText(normalized);
  if (/猫|小猫|猫咪/.test(normalized)) return catSketchRecipeFromText(normalized);
  if (/房子|房屋|小屋|屋子|小房子/.test(normalized)) return houseSketchRecipeFromText(normalized);
  if (/花|小花|花朵/.test(normalized)) return flowerSketchRecipeFromText(normalized);
  if (/树|小树|树木/.test(normalized)) return treeSketchRecipeFromText(normalized);
  return null;
}

function recipeOriginFromCursor() {
  return {
    x: state.turtle.x,
    y: state.turtle.y
  };
}

function recipeScaleFromText(text) {
  const gridUnits = gridCountFromText(text);
  if (Number.isFinite(gridUnits)) return clamp(gridUnits / 5, 0.72, 1.45);
  if (/很大/.test(text)) return 1.32;
  if (/大/.test(text)) return 1.16;
  if (/很小/.test(text)) return 0.76;
  if (/小/.test(text)) return 0.9;
  return 1;
}

function roundPoint(value) {
  return Math.round(value * 1000) / 1000;
}

function sketchTools(text, fallbackColor = "black") {
  const normalized = normalizeSpeechText(text);
  const { width, height } = canvasSize();
  const origin = recipeOriginFromCursor();
  const scale = recipeScaleFromText(normalized);
  const primary = palette[colorFromText(normalized, fallbackColor)] || state.turtle.stroke;
  const strokeWidth = pathStrokeWidthFromText(normalized);
  const point = (dx = 0, dy = 0) => ({
    x: roundPoint(clamp(origin.x + (dx * scale) / Math.max(1, width), 0.06, 0.94)),
    y: roundPoint(clamp(origin.y + (dy * scale) / Math.max(1, height), 0.08, 0.92))
  });
  const move = (dx, dy) => ({ type: "move_cursor", position: point(dx, dy) });
  const line = (angle, distance, stroke = primary, widthOverride = strokeWidth) => ({
    type: "draw_path",
    path: "line",
    angle,
    distance: Math.round(distance * scale),
    anchor: "cursor",
    stroke,
    strokeWidth: widthOverride
  });
  const curve = (angle, distance, stroke = primary, widthOverride = strokeWidth, bend = 1) => ({
    type: "draw_path",
    path: "curve",
    angle,
    distance: Math.round(distance * scale),
    bend,
    anchor: "cursor",
    stroke,
    strokeWidth: widthOverride
  });
  const circle = (dx, dy, radius, stroke = primary, widthOverride = strokeWidth) => ({
    type: "draw_path",
    path: "circle",
    position: point(dx, dy),
    radius: Math.round(radius * scale),
    stroke,
    fill: "transparent",
    strokeWidth: widthOverride
  });
  const filledCircle = (dx, dy, radius, fill, stroke = detailStroke(), widthOverride = strokeWidth) => ({
    type: "draw_path",
    path: "circle",
    position: point(dx, dy),
    radius: Math.round(radius * scale),
    stroke,
    fill,
    strokeWidth: widthOverride
  });
  const detailStroke = () => palette.black;
  return { primary, strokeWidth, move, line, curve, circle, filledCircle };
}

function catSketchRecipeFromText(text) {
  const tools = sketchTools(text, "black");
  const detail = palette.black;
  const accent = palette.pink;
  return {
    label: "小猫运笔配方",
    plan: [
      "先画小猫的圆头和身体",
      "用三角线条画两只耳朵",
      "补上眼睛、鼻子、胡须和尾巴"
    ],
    actions: [
      tools.circle(0, -50, 42),
      tools.circle(0, 32, 54),
      tools.move(-34, -82),
      tools.line(-118, 36),
      tools.line(58, 36),
      tools.line(180, 34),
      tools.move(34, -82),
      tools.line(-62, 36),
      tools.line(122, 36),
      tools.line(0, 34),
      tools.circle(-15, -54, 8, detail, 3),
      tools.circle(15, -54, 8, detail, 3),
      tools.circle(0, -37, 8, accent, 3),
      tools.move(-10, -30),
      tools.curve(145, 34, detail, 3),
      tools.move(10, -30),
      tools.curve(35, 34, detail, 3),
      tools.move(-13, -36),
      tools.line(180, 42, detail, 3),
      tools.move(-13, -31),
      tools.line(162, 42, detail, 3),
      tools.move(13, -36),
      tools.line(0, 42, detail, 3),
      tools.move(13, -31),
      tools.line(18, 42, detail, 3),
      tools.move(42, 40),
      tools.curve(-42, 66)
    ]
  };
}

function dogSketchRecipeFromText(text) {
  const tools = sketchTools(text, "brown");
  const detail = palette.black;
  const head = "#f5deb3";
  const ear = "#8b4513";
  return {
    label: "小狗运笔配方",
    plan: [
      "先画小狗的大圆脸",
      "用两组棕色圆画左右耳朵",
      "补上眼白、瞳孔、鼻子和两段嘴巴弧线"
    ],
    actions: [
      tools.filledCircle(0, 0, 80, head, detail, 3),
      tools.filledCircle(-65, -50, 25, ear, detail, 3),
      tools.filledCircle(-85, -20, 25, ear, detail, 3),
      tools.filledCircle(65, -50, 25, ear, detail, 3),
      tools.filledCircle(85, -20, 25, ear, detail, 3),
      tools.filledCircle(-30, -20, 15, palette.white, detail, 3),
      tools.filledCircle(-30, -20, 6, detail, detail, 2),
      tools.filledCircle(30, -20, 15, palette.white, detail, 3),
      tools.filledCircle(30, -20, 6, detail, detail, 2),
      tools.filledCircle(0, 15, 12, detail, detail, 2),
      tools.move(0, 35),
      tools.curve(118, 40, detail, 3, 1),
      tools.move(0, 35),
      tools.curve(62, 40, detail, 3, -1)
    ]
  };
}

function houseSketchRecipeFromText(text) {
  const tools = sketchTools(text, "brown");
  const roof = palette.orange;
  const detail = palette.black;
  return {
    label: "小房子运笔配方",
    plan: [
      "先用四条线画墙体",
      "再用两条斜线画屋顶",
      "最后补门和窗户"
    ],
    actions: [
      tools.move(-82, -8),
      tools.line(0, 164),
      tools.line(90, 118),
      tools.line(180, 164),
      tools.line(-90, 118),
      tools.move(-96, -8),
      tools.line(-35, 116, roof),
      tools.line(35, 116, roof),
      tools.move(-24, 54),
      tools.line(90, 72, detail, 3),
      tools.line(0, 48, detail, 3),
      tools.line(-90, 72, detail, 3),
      tools.move(38, 26),
      tools.line(0, 42, detail, 3),
      tools.line(90, 42, detail, 3),
      tools.line(180, 42, detail, 3),
      tools.line(-90, 42, detail, 3)
    ]
  };
}

function flowerSketchRecipeFromText(text) {
  const tools = sketchTools(text, "pink");
  const stem = palette.green;
  const center = palette.yellow;
  return {
    label: "小花运笔配方",
    plan: [
      "用多个小圆画花瓣",
      "画花心",
      "向下画花茎和叶子"
    ],
    actions: [
      tools.circle(0, -54, 18),
      tools.circle(26, -28, 18),
      tools.circle(0, -2, 18),
      tools.circle(-26, -28, 18),
      tools.circle(0, -28, 12, center, 3),
      tools.move(0, -8),
      tools.line(90, 104, stem, 4),
      tools.move(0, 42),
      tools.curve(38, 48, stem, 4),
      tools.move(0, 55),
      tools.curve(142, 48, stem, 4)
    ]
  };
}

function treeSketchRecipeFromText(text) {
  const tools = sketchTools(text, "green");
  const trunk = palette.brown;
  return {
    label: "小树运笔配方",
    plan: [
      "先画树冠的几个圆形轮廓",
      "再画树干",
      "补一条地面线让小树站住"
    ],
    actions: [
      tools.circle(-34, -42, 36),
      tools.circle(24, -55, 42),
      tools.circle(45, -16, 36),
      tools.circle(-12, -8, 42),
      tools.move(-18, 25),
      tools.line(90, 92, trunk, 5),
      tools.move(18, 25),
      tools.line(90, 92, trunk, 5),
      tools.move(-52, 118),
      tools.line(0, 104, trunk, 4)
    ]
  };
}

function cursorCommandFromText(text) {
  const normalized = normalizeSpeechText(text);
  const mentionsCursor = /指针|光标|笔尖/.test(normalized) || (/画笔/.test(normalized) && /移动|移到|挪到|放到/.test(normalized));
  if (!mentionsCursor) return null;
  if (!/移动|移到|挪到|放到|回到|向|往|走/.test(normalized)) return null;

  const gridCount = gridCountFromText(normalized);
  const wantsAbsolute = /移到|移动到|挪到|放到|回到/.test(normalized) || Boolean(gridCellFromText(normalized));
  const position = wantsAbsolute ? positionFromText(normalized) : null;
  const distance = position ? null : gridDistanceFromText(normalized) || numberFromText(normalized, gridUnit);
  const action = {
    type: "move_cursor",
    direction: position ? null : directionFromText(normalized),
    distance,
    gridUnits: position ? null : gridCount,
    position
  };

  return {
    plan: [cursorActionLabel(action)],
    actions: [action]
  };
}

function cursorActionLabel(action) {
  if (action.position) return "把指针移动到指定位置";
  if (action.gridUnits) return `指针向${directionLabel(action.direction)}移动 ${action.gridUnits} 格`;
  return `指针向${directionLabel(action.direction)}移动 ${action.distance} 像素`;
}

function turnCommandFromText(text) {
  const normalized = normalizeSpeechText(text);
  const mentionsTurn = /旋转|转动|转向|转/.test(normalized);
  if (!mentionsTurn) return null;

  const clockwise = /顺时针|右转|向右转/.test(normalized);
  const counterClockwise = /逆时针|左转|向左转/.test(normalized);
  const mentionsCursor = /指针|光标|笔尖|画笔|海龟/.test(normalized);
  if (!clockwise && !counterClockwise && !mentionsCursor) return null;

  const angle = angleFromText(normalized, 90);
  const signedAngle = counterClockwise ? -angle : angle;
  return {
    plan: [turnActionLabel(signedAngle)],
    actions: [{ type: "turtle_turn", angle: signedAngle }]
  };
}

function pathCommandFromText(text) {
  const normalized = normalizeSpeechText(text);
  if (/改成|变成|换成|变大|放大|变小|缩小|移动|移到|放到|挪到|删除|去掉|移除/.test(normalized)) {
    return null;
  }
  const path = pathKindFromText(normalized);
  if (!path) return null;
  const gridCount = gridCountFromText(normalized);

  const action = {
    type: "draw_path",
    path,
    stroke: palette[colorFromText(normalized, "black")] || state.turtle.stroke,
    strokeWidth: pathStrokeWidthFromText(normalized),
    direction: directionFromText(normalized),
    distance: path === "circle" ? null : pathDistanceFromText(normalized),
    radius: path === "circle" ? pathRadiusFromText(normalized) : null,
    gridUnits: path === "circle" ? null : gridCount,
    radiusGridUnits: path === "circle" ? gridCount : null,
    anchor: pathAnchorFromText(normalized, path),
    position: path === "circle" ? positionFromText(normalized) : null,
    target: targetFromText(normalized)
  };

  return {
    plan: [pathActionLabel(action)],
    actions: [action]
  };
}

function pathStrokeWidthFromText(text) {
  if (/很粗/.test(text)) return Math.min(14, state.turtle.strokeWidth + 4);
  if (/粗/.test(text)) return Math.min(14, state.turtle.strokeWidth + 2);
  if (/很细/.test(text)) return Math.max(1, state.turtle.strokeWidth - 3);
  if (/细/.test(text)) return Math.max(1, state.turtle.strokeWidth - 1);
  return state.turtle.strokeWidth;
}

function pathDistanceFromText(text) {
  const gridDistance = gridDistanceFromText(text);
  if (Number.isFinite(gridDistance)) return gridDistance;
  const fallback = /长/.test(text) ? 170 : /短/.test(text) ? 72 : 120;
  return numberFromText(text, fallback);
}

function pathRadiusFromText(text) {
  const gridDistance = gridDistanceFromText(text);
  if (Number.isFinite(gridDistance)) return gridDistance;
  const fallback = /大/.test(text) ? 72 : /小/.test(text) ? 38 : 54;
  return numberFromText(text, fallback);
}

function directionFromText(text) {
  if (/向左|往左|左边|左/.test(text)) return "left";
  if (/向上|往上|上面|上/.test(text)) return "up";
  if (/向下|往下|下面|下/.test(text)) return "down";
  if (/向前|往前|前进/.test(text)) return "forward";
  if (/竖线/.test(text)) return "down";
  return "right";
}

function pathAnchorFromText(text, path) {
  if (/从.*右边|它右边|圆右边|右侧/.test(text)) return "right";
  if (/从.*左边|它左边|圆左边|左侧/.test(text)) return "left";
  if (/从.*上面|它上面|圆上面|顶部/.test(text)) return "top";
  if (/从.*下面|它下面|圆下面|底部/.test(text)) return "bottom";
  if (/末端|终点|结尾|接着|继续|上一笔/.test(text)) return "last_end";
  if (path === "circle" && /刚才|上一个|它|这个/.test(text)) return "center";
  return "cursor";
}

function pathActionLabel(action) {
  if (action.path === "circle" && action.radiusGridUnits) return `用画笔画半径 ${action.radiusGridUnits} 格的圆`;
  if (hasActionAngle(action)) return `从上下文位置按 ${action.angle} 度画${action.path === "curve" ? "曲线" : "直线"}`;
  if (action.gridUnits) return `从上下文位置向${directionLabel(action.direction)}画 ${action.gridUnits} 格${action.path === "curve" ? "曲线" : "直线"}`;
  if (action.path === "circle") return `用画笔画半径 ${action.radius} 的圆`;
  if (action.path === "curve") return `从上下文位置向${directionLabel(action.direction)}画一条曲线`;
  return `从上下文位置向${directionLabel(action.direction)}画一条直线`;
}

function directionLabel(direction) {
  const labels = { left: "左", right: "右", up: "上", down: "下", forward: "前" };
  return labels[direction] || "右";
}

function vectorFromAngle(angle) {
  const radians = (angle * Math.PI) / 180;
  return [Math.cos(radians), Math.sin(radians)];
}

function hasActionAngle(action) {
  return typeof action?.angle === "number" && Number.isFinite(action.angle);
}

function normalizeAngle(angle) {
  return ((angle % 360) + 360) % 360;
}

function headingLabel(angle = state.turtle.angle) {
  return `${Math.round(normalizeAngle(angle) * 10) / 10}°`;
}

function turnActionLabel(angle) {
  return `${angle >= 0 ? "顺时针旋转" : "逆时针旋转"} ${Math.abs(angle)} 度`;
}

function directionVector(direction) {
  const vectors = {
    left: [-1, 0],
    right: [1, 0],
    up: [0, -1],
    down: [0, 1],
    forward: vectorFromAngle(state.turtle.angle)
  };
  return vectors[direction] || vectors.right;
}

function turtlePathFromText(text) {
  const normalized = normalizeSpeechText(text);
  const basicShapePlan = basicShapeSketchPlanFromText(normalized);
  if (basicShapePlan) return basicShapePlan;

  const starPlan = starPlanFromText(normalized);
  if (starPlan) return starPlan;

  const objectRecipe = objectSketchRecipeFromText(normalized);
  if (objectRecipe) return objectRecipe;

  const wantsTurtlePath = /海龟|画笔|路径|轮廓|一笔/.test(normalized);
  if (!wantsTurtlePath) return null;

  if (/正方形|方形|方块/.test(normalized)) {
    return turtlePathPlan("用画笔画正方形", [
      { type: "turtle_home" },
      { type: "pen_down" },
      { type: "turtle_forward", distance: 100 },
      { type: "turtle_turn", angle: 90 },
      { type: "turtle_forward", distance: 100 },
      { type: "turtle_turn", angle: 90 },
      { type: "turtle_forward", distance: 100 },
      { type: "turtle_turn", angle: 90 },
      { type: "turtle_forward", distance: 100 },
      { type: "pen_up" }
    ]);
  }

  if (/三角形|三角/.test(normalized)) {
    return turtlePathPlan("用画笔画三角形", [
      { type: "turtle_home" },
      { type: "pen_down" },
      { type: "turtle_forward", distance: 120 },
      { type: "turtle_turn", angle: 120 },
      { type: "turtle_forward", distance: 120 },
      { type: "turtle_turn", angle: 120 },
      { type: "turtle_forward", distance: 120 },
      { type: "pen_up" }
    ]);
  }

  return null;
}

function turtlePathPlan(title, actions) {
  return {
    plan: actions.map((action) => turtleActionLabel(action)),
    actions,
    label: title
  };
}

function turtleActionLabel(action) {
  if (action.type === "turtle_home") return "画笔回到中心，准备开始";
  if (action.type === "pen_down") return "落笔，开始留下线条";
  if (action.type === "pen_up") return "抬笔，结束这段路径";
  if (action.type === "turtle_forward" && action.gridUnits) return `${action.distance >= 0 ? "前进" : "后退"} ${Math.abs(action.gridUnits)} 格`;
  if (action.type === "turtle_forward") return `${action.distance >= 0 ? "前进" : "后退"} ${Math.abs(action.distance)} 像素`;
  if (action.type === "turtle_turn") return turnActionLabel(action.angle);
  return "执行画笔动作";
}

function turtleCommandFromText(text) {
  const normalized = normalizeSpeechText(text);
  const pathPlan = turtlePathFromText(normalized);
  if (pathPlan) return pathPlan;
  const mentionsDrawableTarget = /圆|矩形|方形|方块|三角|线|曲线|弧线|箭头/.test(normalized);

  if (/落笔|下笔|开始画/.test(normalized)) return { actions: [{ type: "pen_down" }], plan: ["落下画笔，后续移动会留下线条"] };
  if (/抬笔|提笔|停止画/.test(normalized)) return { actions: [{ type: "pen_up" }], plan: ["抬起画笔，后续移动只改变画笔位置"] };
  if (/回到中心|回中心|回原点|回到原点/.test(normalized)) return { actions: [{ type: "turtle_home" }], plan: ["把画笔移动回画布中心"] };

  const turnCommand = turnCommandFromText(normalized);
  if (turnCommand) return turnCommand;

  if (/向后|后退|倒退/.test(normalized)) {
    const gridCount = gridCountFromText(normalized);
    const distance = gridDistanceFromText(normalized) || numberFromText(normalized, 80);
    return {
      actions: [{ type: "turtle_forward", distance: -distance, gridUnits: gridCount }],
      plan: [gridCount ? `向后退 ${gridCount} 格` : `向后退 ${distance} 像素`]
    };
  }
  if (/向前|前进|往前|走/.test(normalized)) {
    const gridCount = gridCountFromText(normalized);
    const distance = gridDistanceFromText(normalized) || numberFromText(normalized, 80);
    return {
      actions: [{ type: "turtle_forward", distance, gridUnits: gridCount }],
      plan: [gridCount ? `向前走 ${gridCount} 格` : `向前走 ${distance} 像素`]
    };
  }
  if (/换成|改成|颜色/.test(normalized) && hasColorWord(normalized) && (/画笔|线条|笔|海龟/.test(normalized) || !mentionsDrawableTarget)) {
    const color = palette[colorFromText(normalized, "black")];
    return { actions: [{ type: "turtle_color", stroke: color }], plan: ["更换画笔颜色"] };
  }
  if (/线条|画笔|笔/.test(normalized) && /粗|细/.test(normalized)) {
    const current = state.turtle.strokeWidth;
    const width = /细/.test(normalized) ? Math.max(1, current - 1) : Math.min(12, current + 1);
    return { actions: [{ type: "turtle_width", width }], plan: [`把画笔线宽调到 ${width}`] };
  }

  return null;
}

function parseCommand(text) {
  const normalized = normalizeSpeechText(text);
  const actions = [];
  const plans = [];
  const hasSegmentBreak = /然后|再|并且|同时|一起|还有|和|，|,|。|；|;/.test(String(text || ""));
  const hasSequencingBreak = /然后|再|并且|同时|一起|还有|和/.test(String(text || ""));

  if (/撤销|退回|上一步/.test(normalized)) {
    return { actions: [{ type: "undo" }] };
  }
  if (/重做|恢复/.test(normalized)) {
    return { actions: [{ type: "redo" }] };
  }
  if (/清空|清除全部|全部删除/.test(normalized)) {
    return { actions: [{ type: "clear_canvas" }] };
  }
  if (/显示|打开/.test(normalized) && /坐标|网格|九宫格|编号/.test(normalized)) {
    return { actions: [{ type: "set_grid", visible: true }] };
  }
  if (/隐藏|关闭/.test(normalized) && /坐标|网格|九宫格|编号/.test(normalized)) {
    return { actions: [{ type: "set_grid", visible: false }] };
  }

  const cursorCommand = cursorCommandFromText(normalized);
  if (cursorCommand && !hasSegmentBreak) return cursorCommand;

  const basicShapePlan = basicShapeSketchPlanFromText(normalized);
  if (basicShapePlan && !hasSequencingBreak) return basicShapePlan;

  const starPlan = starPlanFromText(normalized);
  if (starPlan && !hasSequencingBreak) return starPlan;

  const objectRecipe = objectSketchRecipeFromText(normalized);
  if (objectRecipe && !hasSequencingBreak) return objectRecipe;

  const pathCommand = pathCommandFromText(normalized);
  if (pathCommand && !hasSegmentBreak) return pathCommand;

  const turtleCommand = turtleCommandFromText(normalized);
  if (turtleCommand && !hasSegmentBreak) return turtleCommand;

  const plannedObject = plannedObjectFromText(normalized);
  if (plannedObject) return plannedObject;

  const segments = String(text || "")
    .toLowerCase()
    .split(/然后|再|并且|同时|一起|还有|和|，|,|。|；|;/)
    .map((part) => normalizeSpeechText(part))
    .filter(Boolean);

  for (const segment of segments) {
    const segmentCursorCommand = cursorCommandFromText(segment);
    if (segmentCursorCommand) {
      actions.push(...segmentCursorCommand.actions);
      plans.push(...(segmentCursorCommand.plan || []));
      continue;
    }

    const segmentBasicShapePlan = basicShapeSketchPlanFromText(segment);
    if (segmentBasicShapePlan) {
      actions.push(...segmentBasicShapePlan.actions);
      plans.push(...(segmentBasicShapePlan.plan || []));
      continue;
    }

    const segmentStarPlan = starPlanFromText(segment);
    if (segmentStarPlan) {
      actions.push(...segmentStarPlan.actions);
      plans.push(...(segmentStarPlan.plan || []));
      continue;
    }

    const segmentObjectRecipe = objectSketchRecipeFromText(segment);
    if (segmentObjectRecipe) {
      actions.push(...segmentObjectRecipe.actions);
      plans.push(...(segmentObjectRecipe.plan || []));
      continue;
    }

    const segmentPathCommand = pathCommandFromText(segment);
    if (segmentPathCommand) {
      actions.push(...segmentPathCommand.actions);
      plans.push(...(segmentPathCommand.plan || []));
      continue;
    }

    const segmentTurtleCommand = turtleCommandFromText(segment);
    if (segmentTurtleCommand) {
      actions.push(...segmentTurtleCommand.actions);
      plans.push(...(segmentTurtleCommand.plan || []));
      continue;
    }

    if (/改成|变成|换成/.test(segment)) {
      actions.push({
        type: "update_object",
        target: targetFromText(segment),
        updates: { fill: palette[colorFromText(segment, "yellow")] }
      });
      continue;
    }

    if (/变大|放大|变小|缩小/.test(segment)) {
      actions.push({
        type: "resize_object",
        target: targetFromText(segment),
        scale: /变小|缩小/.test(segment) ? 0.82 : 1.18
      });
      continue;
    }

    if (/移动|移到|放到|挪到/.test(segment) && !/画/.test(segment)) {
      actions.push({
        type: "move_object",
        target: targetFromText(segment),
        position: positionFromText(segment) || "center"
      });
      continue;
    }

    if (/删除|去掉|移除/.test(segment)) {
      actions.push({
        type: "delete_object",
        target: targetFromText(segment)
      });
      continue;
    }

    if (/写|文字|文本/.test(segment)) {
      continue;
    }

    const basicShapePlan = basicShapeSketchPlanFromText(segment);
    if (basicShapePlan) {
      actions.push(...basicShapePlan.actions);
      plans.push(...(basicShapePlan.plan || []));
    }
  }

  if (!actions.length) {
    return {
      clarification: "我现在先支持直线、曲线、圆、画笔移动，也可以让 OpenAI 尝试把物体拆成运笔步骤。"
    };
  }

  return plans.length ? { actions, plan: plans } : { actions };
}

function isExecutableDsl(dsl) {
  return Array.isArray(dsl?.actions) && dsl.actions.length > 0;
}

function wantsLlmSketchPlanning(text) {
  const normalized = normalizeSpeechText(text);
  if (!/画|绘制|生成|来一个/.test(normalized)) return false;
  if (/五角星|星星|五芒星|三角形|三角|矩形|长方形|正方形|方块|方形|直线|曲线|圆|圆形|圆圈/.test(normalized)) {
    return false;
  }
  if (/画笔|笔尖|指针|光标|落笔|抬笔|颜色|粗细|线宽|旋转|转向|前进|移动/.test(normalized)) return false;
  if (/狗|小狗|狗狗|小犬|猫|小猫|猫咪|房子|房屋|小屋|屋子|小房子|花|小花|花朵|树|小树|树木|汽车|小车|车子|轿车|太阳|云|女孩|小女孩/.test(normalized)) {
    return true;
  }
  return /(?:画|绘制|生成)(?:一个|个|一只|只|一条|条|一棵|棵|一朵|朵|一辆|辆|一座|座|一间|间)[\u4e00-\u9fa5]{1,8}/.test(normalized)
    || /来一个[\u4e00-\u9fa5]{1,8}/.test(normalized);
}

function shouldUseLlm(text, localDsl) {
  if (state.llmInFlight || state.llmAvailable === false) return false;
  if (localDsl?.skipLlm) return false;
  if (localDsl?.label && /运笔配方|动作配方/.test(localDsl.label)) return false;
  if (wantsLlmSketchPlanning(text)) return true;
  if (Array.isArray(localDsl?.plan) && localDsl.plan.length) return false;
  if (isExecutableDsl(localDsl) && localDsl.actions.every((action) => ["move_cursor", "draw_path"].includes(action.type))) return false;
  const normalized = normalizeSpeechText(text);
  if (localDsl?.clarification) return true;
  if (llmComplexPattern.test(normalized)) return true;
  return isExecutableDsl(localDsl) && localDsl.actions.length >= 3;
}

function normalizeFill(value, fallback = palette.blue) {
  if (!value) return fallback;
  const text = String(value).trim();
  if (/^#[0-9a-f]{6}$/i.test(text)) return text.toLowerCase();
  if (palette[text]) return palette[text];
  const color = colorFromText(text, "");
  return color && palette[color] ? palette[color] : fallback;
}

function sanitizePosition(value) {
  if (supportedPositions.includes(value)) return value;
  if (typeof value === "object" && value !== null) {
    const x = Number(value.x);
    const y = Number(value.y);
    if (Number.isFinite(x) && Number.isFinite(y)) {
      return { x: clamp(x, 0.05, 0.95), y: clamp(y, 0.05, 0.95) };
    }
  }
  return null;
}

function sanitizeRelativeTo(relativeTo) {
  if (!relativeTo || typeof relativeTo !== "object") return null;
  const target = supportedTargets.includes(relativeTo.target) ? relativeTo.target : "last_created";
  const placement = supportedPlacements.includes(relativeTo.placement) ? relativeTo.placement : "right";
  return { target, placement };
}

function sanitizeAction(action) {
  if (!action || typeof action !== "object" || !supportedActions.includes(action.type)) return null;

  if (["undo", "redo", "clear_canvas"].includes(action.type)) {
    return { type: action.type };
  }

  if (action.type === "pen_down" || action.type === "pen_up" || action.type === "turtle_home") {
    return { type: action.type };
  }

  if (action.type === "turtle_forward") {
    const gridUnits = Number(action.gridUnits);
    const distance = Number(action.distance);
    const resolvedDistance = Number.isFinite(gridUnits) ? gridUnits * gridUnit : distance;
    return {
      type: "turtle_forward",
      distance: Number.isFinite(resolvedDistance) ? clamp(resolvedDistance, -260, 260) : 80,
      gridUnits: Number.isFinite(gridUnits) ? clamp(gridUnits, -20, 20) : null
    };
  }

  if (action.type === "turtle_turn") {
    const angle = Number(action.angle);
    return {
      type: "turtle_turn",
      angle: Number.isFinite(angle) ? clamp(angle, -360, 360) : 90
    };
  }

  if (action.type === "turtle_color") {
    return {
      type: "turtle_color",
      stroke: normalizeFill(action.stroke || action.fill, palette.black)
    };
  }

  if (action.type === "turtle_width") {
    const width = Number(action.width);
    return {
      type: "turtle_width",
      width: Number.isFinite(width) ? clamp(width, 1, 14) : 4
    };
  }

  if (action.type === "set_grid") {
    return { type: "set_grid", visible: action.visible !== false };
  }

  if (action.type === "move_cursor") {
    const gridUnits = Number(action.gridUnits);
    const distance = Number(action.distance);
    const direction = ["left", "right", "up", "down", "forward"].includes(action.direction)
      ? action.direction
      : "right";
    const position = sanitizePosition(action.position);
    return {
      type: "move_cursor",
      direction,
      distance: position ? null : Number.isFinite(gridUnits) ? clamp(gridUnits * gridUnit, 1, 320) : Number.isFinite(distance) ? clamp(distance, 1, 320) : gridUnit,
      gridUnits: position ? null : Number.isFinite(gridUnits) ? clamp(gridUnits, 1, 20) : null,
      position
    };
  }

  if (action.type === "draw_path") {
    const path = ["line", "curve", "circle"].includes(action.path) ? action.path : "line";
    const gridUnits = Number(action.gridUnits);
    const radiusGridUnits = Number(action.radiusGridUnits);
    const distance = Number(action.distance);
    const radius = Number(action.radius);
    const strokeWidth = Number(action.strokeWidth);
    const anchor = ["cursor", "last_end"].includes(action.anchor)
      ? action.anchor
      : "cursor";
    const direction = ["left", "right", "up", "down", "forward"].includes(action.direction)
      ? action.direction
      : "right";
    const angle = Number(action.angle);
    return {
      type: "draw_path",
      path,
      stroke: normalizeFill(action.stroke || action.fill, state.turtle.stroke),
      fill: normalizeFill(action.fill, "transparent"),
      strokeWidth: Number.isFinite(strokeWidth) ? clamp(strokeWidth, 1, 14) : state.turtle.strokeWidth,
      distance: Number.isFinite(gridUnits) ? clamp(gridUnits * gridUnit, 12, 320) : Number.isFinite(distance) ? clamp(distance, 12, 320) : 120,
      radius: Number.isFinite(radiusGridUnits) ? clamp(radiusGridUnits * gridUnit, 8, 150) : Number.isFinite(radius) ? clamp(radius, 8, 150) : 54,
      gridUnits: Number.isFinite(gridUnits) ? clamp(gridUnits, 1, 20) : null,
      radiusGridUnits: Number.isFinite(radiusGridUnits) ? clamp(radiusGridUnits, 1, 10) : null,
      direction,
      angle: Number.isFinite(angle) ? clamp(angle, -360, 360) : null,
      anchor,
      target: supportedTargets.includes(action.target) ? action.target : "last_created",
      position: null
    };
  }

  if (action.type === "create_shape") {
    const shape = supportedShapes.includes(action.shape) ? action.shape : null;
    if (!shape) return null;
    const size = Number(action.size);
    const fill = normalizeFill(action.fill, shape === "text" ? palette.black : palette.blue);
    return {
      type: "create_shape",
      shape,
      text: String(action.text || "").slice(0, 24),
      fill,
      stroke: shape === "line" || shape === "arrow" ? normalizeFill(action.stroke || action.fill, fill) : "#1f2937",
      strokeWidth: Number.isFinite(Number(action.strokeWidth)) ? clamp(Number(action.strokeWidth), 1, 14) : 3,
      position: sanitizePosition(action.position) || "center",
      relativeTo: sanitizeRelativeTo(action.relativeTo),
      size: Number.isFinite(size) ? clamp(size, 48, 260) : 120,
      width: Number.isFinite(Number(action.width)) ? clamp(Number(action.width), 8, 280) : null,
      height: Number.isFinite(Number(action.height)) ? clamp(Number(action.height), 8, 280) : null,
      rotation: Number.isFinite(Number(action.rotation)) ? clamp(Number(action.rotation), -360, 360) : 0,
      label: String(action.label || "").slice(0, 20),
      style: "cute_flat"
    };
  }

  if (action.type === "update_object") {
    const target = supportedTargets.includes(action.target) ? action.target : "last_created";
    const updates = {};
    if (action.updates?.fill) updates.fill = normalizeFill(action.updates.fill, palette.yellow);
    return Object.keys(updates).length ? { type: "update_object", target, updates } : null;
  }

  if (action.type === "resize_object") {
    const target = supportedTargets.includes(action.target) ? action.target : "last_created";
    const scale = Number(action.scale);
    return {
      type: "resize_object",
      target,
      scale: Number.isFinite(scale) ? clamp(scale, 0.55, 1.85) : 1.18
    };
  }

  if (action.type === "move_object") {
    const target = supportedTargets.includes(action.target) ? action.target : "last_created";
    return {
      type: "move_object",
      target,
      position: sanitizePosition(action.position) || "center"
    };
  }

  if (action.type === "delete_object") {
    const target = supportedTargets.includes(action.target) ? action.target : "last_created";
    return { type: "delete_object", target };
  }

  return null;
}

function sanitizeDsl(dsl) {
  if (!dsl || typeof dsl !== "object") {
    return { clarification: "LLM 没有返回可执行指令，已降级到本地规则。" };
  }

  if (dsl.clarification && !Array.isArray(dsl.actions)) {
    return { clarification: String(dsl.clarification).slice(0, 80) };
  }

  const actions = Array.isArray(dsl.actions)
    ? dsl.actions.map(sanitizeAction).filter(Boolean)
    : [];

  if (!actions.length) {
    return dsl.clarification
      ? { clarification: String(dsl.clarification).slice(0, 80) }
      : { clarification: "LLM 返回的动作不在当前画布能力范围内。" };
  }

  return {
    source: dsl.source || "llm",
    plan: Array.isArray(dsl.plan)
      ? dsl.plan.map((step) => String(step || "").trim()).filter(Boolean).slice(0, 10)
      : [],
    actions
  };
}

function roundMetric(value, digits = 3) {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function llmCanvasContext() {
  const { width, height } = canvasSize();
  const safeMargin = Math.max(48, gridUnit * 2);
  const cursorPixel = {
    x: state.turtle.x * width,
    y: state.turtle.y * height
  };
  const roomGridUnits = {
    left: roundMetric(cursorPixel.x / gridUnit, 1),
    right: roundMetric((width - cursorPixel.x) / gridUnit, 1),
    up: roundMetric(cursorPixel.y / gridUnit, 1),
    down: roundMetric((height - cursorPixel.y) / gridUnit, 1)
  };
  const nearEdges = Object.entries(roomGridUnits)
    .filter(([, grids]) => grids < 4)
    .map(([edge]) => edge);

  return {
    width: Math.round(width),
    height: Math.round(height),
    gridUnit,
    gridColumns: Math.max(1, Math.floor(width / gridUnit)),
    gridRows: Math.max(1, Math.floor(height / gridUnit)),
    coordinateSystem: "pixel origin is top-left; x increases right; y increases down; normalized x/y are 0..1.",
    safeFrame: {
      pixel: {
        left: Math.round(safeMargin),
        top: Math.round(safeMargin),
        right: Math.round(width - safeMargin),
        bottom: Math.round(height - safeMargin)
      },
      normalized: {
        left: roundMetric(safeMargin / Math.max(1, width)),
        top: roundMetric(safeMargin / Math.max(1, height)),
        right: roundMetric((width - safeMargin) / Math.max(1, width)),
        bottom: roundMetric((height - safeMargin) / Math.max(1, height))
      },
      note: "Keep object strokes inside this safe frame whenever possible."
    },
    cursorPixel: {
      x: Math.round(cursorPixel.x),
      y: Math.round(cursorPixel.y)
    },
    cursorGrid: {
      x: roundMetric(cursorPixel.x / gridUnit, 1),
      y: roundMetric(cursorPixel.y / gridUnit, 1)
    },
    roomGridUnits,
    edgeHint: nearEdges.length
      ? `Cursor is near ${nearEdges.join(", ")} edge; draw inward and avoid moving farther toward that edge.`
      : "Cursor has enough room around it for a compact sketch."
  };
}

function llmContext() {
  const canvasContext = llmCanvasContext();
  return {
    objectCount: state.objects.length,
    canvas: canvasContext,
    cursor: {
      x: Number(state.turtle.x.toFixed(3)),
      y: Number(state.turtle.y.toFixed(3)),
      pixelX: canvasContext.cursorPixel.x,
      pixelY: canvasContext.cursorPixel.y,
      gridX: canvasContext.cursorGrid.x,
      gridY: canvasContext.cursorGrid.y,
      angle: Number(state.turtle.angle.toFixed(1)),
      penDown: state.turtle.penDown,
      stroke: state.turtle.stroke,
      strokeWidth: state.turtle.strokeWidth,
      coordinateMode: "normalized_canvas",
      roomGridUnits: canvasContext.roomGridUnits,
      note: "All new drawing should start from this cursor unless the user explicitly moves the cursor first. If the cursor is near an edge, plan the object inward so it stays visible."
    },
    gridUnit,
    drawingRules: [
      "Use gridUnits for movement and stroke length; 1 grid = 34 pixels.",
      "move_cursor with direction/gridUnits moves relative to the current cursor.",
      "draw_path line/curve with anchor cursor starts at the current cursor.",
      "draw_path circle with anchor cursor uses the current cursor as the circle center; after the circle is drawn, the runtime cursor ends on the right side of that circle.",
      "For compact objects such as cars or animals, prefer widths around 4-8 grid units and heights around 2-5 grid units."
    ],
    lastObject: state.objects.find((object) => object.id === state.lastObjectId) || null,
    objects: state.objects.map((object) => ({
      id: object.id,
      kind: object.kind,
      shape: object.shape || null,
      label: object.label,
      position: { x: Math.round(object.x), y: Math.round(object.y) }
    })).slice(-12),
    supportedShapes,
    supportedPositions,
    supportedActions
  };
}

async function fetchLlmCommand(text) {
  const response = await fetch("/api/llm-command", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      text,
      context: llmContext()
    })
  });

  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    const error = new Error(body.message || body.error || `LLM request failed: ${response.status}`);
    error.status = response.status;
    throw error;
  }

  return response.json();
}

async function parseCommandSmart(text) {
  const localDsl = parseCommand(text);

  if (!shouldUseLlm(text, localDsl)) {
    return { ...localDsl, source: "local_rules" };
  }

  state.llmInFlight = true;
  setSpeechHint(`复杂口令正在交给 ${state.llmProvider || "OpenAI"} 拆解，稍等一下。`);

  try {
    const result = await fetchLlmCommand(text);
    state.llmAvailable = true;
    state.llmProvider = result.provider || "OpenAI";
    const dsl = sanitizeDsl(result.dsl || result);
    if (isExecutableDsl(dsl)) {
      addLog(`${state.llmProvider} 已拆解复杂口令`);
      return { ...dsl, source: `${state.llmProvider.toLowerCase()}_llm` };
    }
    return dsl;
  } catch (error) {
    if (error.status === 404 || error.status === 503) {
      state.llmAvailable = false;
    }
    addLog(`${state.llmProvider || "OpenAI"} 解析不可用，已回退本地规则：${error.message}`, "error");
    setSpeechHint(`${state.llmProvider || "OpenAI"} 解析暂不可用，已使用本地规则继续执行。`, "warning");
    return { ...localDsl, source: "local_rules_fallback" };
  } finally {
    state.llmInFlight = false;
  }
}

function defaultShapePosition(index, total) {
  if (total === 1) return "center";
  const x = 0.38 + index * 0.18;
  return { x, y: 0.52 };
}

function resolveTarget(target) {
  if (!state.objects.length) return null;
  if (target === "last_created") {
    return state.objects.find((object) => object.id === state.lastObjectId) || state.objects.at(-1);
  }
  for (let i = state.objects.length - 1; i >= 0; i -= 1) {
    const object = state.objects[i];
    if (object.shape === target || object.object === target) return object;
  }
  return state.objects.at(-1);
}

function resolveRelative(relativeTo, size) {
  const target = resolveTarget(relativeTo?.target || "last_created");
  if (!target) return toPoint("center", { width: size, height: size });
  const gap = 36;
  const placement = relativeTo?.placement || "right";
  const offsets = {
    right: [target.w / 2 + size / 2 + gap, 0],
    left: [-(target.w / 2 + size / 2 + gap), 0],
    top: [0, -(target.h / 2 + size / 2 + gap)],
    bottom: [0, target.h / 2 + size / 2 + gap]
  };
  const [dx, dy] = offsets[placement] || offsets.right;
  const { width, height } = canvasSize();
  return {
    x: clamp(target.x + dx, size / 2 + 18, width - size / 2 - 18),
    y: clamp(target.y + dy, size / 2 + 18, height - size / 2 - 18)
  };
}

async function executeDsl(dsl) {
  if (dsl.clarification) {
    addLog(dsl.clarification, "error");
    return;
  }

  state.latestDsl = dsl;
  state.latestPlan = Array.isArray(dsl.plan) ? dsl.plan : [];
  dslOutput.textContent = JSON.stringify(dsl, null, 2);

  const hadTemplateAction = Array.isArray(dsl.actions) && dsl.actions.some((action) => action?.type === "create_shape");
  const actions = Array.isArray(dsl.actions)
    ? dsl.actions.filter((action) => action?.type !== "create_shape")
    : [];
  if (!actions.length) {
    addLog(hadTemplateAction ? "已拒绝形状模板动作，请改用路径笔画规划。" : "没有可执行的绘图动作", "error");
    return;
  }

  const shouldAnimate = shouldAnimateDrawing(dsl);
  state.drawCursor.active = shouldAnimate;

  try {
    for (const action of actions) {
      if (shouldAnimate) {
        await moveDrawingCursorToAction(action);
      }
      if (action.type === "move_cursor") {
        await executeAnimatedCursorMoveAction(action);
      } else if (action.type === "turtle_turn") {
        await executeAnimatedTurtleTurnAction(action);
      } else if (action.type === "draw_path") {
        await executeAnimatedPathAction(action);
      } else {
        executeAction(action);
      }
      updatePanels();
      draw();
      if (shouldAnimate) {
        await wait(90);
      }
    }

    if (shouldAnimate) {
      await wait(160);
    }
  } finally {
    if (shouldAnimate) {
      state.drawCursor.active = false;
      draw();
    }
  }
}

function shouldAnimateDrawing(dsl) {
  const actions = Array.isArray(dsl.actions) ? dsl.actions : [];
  if (actions.length < 2) return false;
  if (!Array.isArray(dsl.plan) || !dsl.plan.length) return false;
  return actions.some((action) => action.type === "draw_path");
}

async function moveDrawingCursorToAction(action) {
  const point = actionPreviewPoint(action);
  if (!point) return;

  const from = { x: state.drawCursor.x, y: state.drawCursor.y };
  const startedAt = performance.now();
  const duration = 180;

  await new Promise((resolve) => {
    function frame(now) {
      const progress = clamp((now - startedAt) / duration, 0, 1);
      const eased = 1 - (1 - progress) ** 3;
      state.drawCursor.x = from.x + (point.x - from.x) * eased;
      state.drawCursor.y = from.y + (point.y - from.y) * eased;
      draw();
      if (progress < 1) {
        window.requestAnimationFrame(frame);
      } else {
        resolve();
      }
    }
    window.requestAnimationFrame(frame);
  });
}

function actionPreviewPoint(action) {
  if (action.type === "draw_path") {
    return normalizedPathPreviewPoint(action);
  }
  return null;
}

function executeAction(action) {
  if (action.type === "undo") {
    undo();
    return;
  }
  if (action.type === "redo") {
    redo();
    return;
  }
  if (action.type === "clear_canvas") {
    pushHistory();
    state.objects = [];
    state.lastObjectId = null;
    state.latestPlan = [];
    state.turtle = initialTurtle();
    state.actionTotal += 1;
    addLog("清空画布");
    return;
  }
  if ([
    "pen_down",
    "pen_up",
    "turtle_forward",
    "turtle_turn",
    "turtle_home",
    "turtle_color",
    "turtle_width"
  ].includes(action.type)) {
    pushHistory();
    executeTurtleAction(action);
    state.actionTotal += 1;
    return;
  }
  if (action.type === "set_grid") {
    pushHistory();
    state.compositionGridVisible = Boolean(action.visible);
    state.actionTotal += 1;
    addLog(`${state.compositionGridVisible ? "显示" : "隐藏"}坐标网格`);
    return;
  }
  if (action.type === "move_cursor") {
    pushHistory();
    executeCursorMove(action);
    state.actionTotal += 1;
    return;
  }

  pushHistory();

  if (action.type === "draw_path") {
    createPathStroke(action);
  } else if (action.type === "create_shape") {
    createShape(action);
  } else if (action.type === "update_object") {
    updateObject(action);
  } else if (action.type === "resize_object") {
    resizeObject(action);
  } else if (action.type === "move_object") {
    moveObject(action);
  } else if (action.type === "delete_object") {
    deleteObject(action);
  }

  state.actionTotal += 1;
}

async function executeAnimatedCursorMoveAction(action) {
  pushHistory();
  const from = { x: state.turtle.x, y: state.turtle.y };
  const to = cursorTargetPoint(action);
  const steps = 14;

  for (let i = 1; i <= steps; i += 1) {
    const progress = i / steps;
    const eased = 1 - (1 - progress) ** 3;
    state.turtle.x = from.x + (to.x - from.x) * eased;
    state.turtle.y = from.y + (to.y - from.y) * eased;
    draw();
    await wait(12);
  }

  state.turtle.x = to.x;
  state.turtle.y = to.y;
  state.actionTotal += 1;
  addLog(cursorMoveLog(action));
}

async function executeAnimatedTurtleTurnAction(action) {
  pushHistory();
  const from = state.turtle.angle;
  const steps = 12;

  for (let i = 1; i <= steps; i += 1) {
    const progress = i / steps;
    const eased = 1 - (1 - progress) ** 3;
    state.turtle.angle = normalizeAngle(from + action.angle * eased);
    draw();
    await wait(10);
  }

  state.turtle.angle = normalizeAngle(from + action.angle);
  state.actionTotal += 1;
  addLog(turnActionLabel(action.angle));
}

function executeCursorMove(action) {
  const to = cursorTargetPoint(action);
  state.turtle.x = to.x;
  state.turtle.y = to.y;
  addLog(cursorMoveLog(action));
}

function cursorTargetPoint(action) {
  const { width, height } = canvasSize();
  if (action.position) {
    const point = toPoint(action.position, { width: 20, height: 20 });
    return {
      x: clamp(point.x / Math.max(1, width), 0.04, 0.96),
      y: clamp(point.y / Math.max(1, height), 0.04, 0.96)
    };
  }

  const distance = Number(action.distance) || gridUnit;
  const [dx, dy] = directionVector(action.direction);
  return {
    x: clamp(state.turtle.x + (dx * distance) / Math.max(1, width), 0.04, 0.96),
    y: clamp(state.turtle.y + (dy * distance) / Math.max(1, height), 0.04, 0.96)
  };
}

function cursorMoveLog(action) {
  if (action.position) return "移动指针到指定位置";
  if (action.gridUnits) return `指针向${directionLabel(action.direction)}移动${action.gridUnits}格`;
  return `指针向${directionLabel(action.direction)}移动${Math.round(action.distance || gridUnit)}像素`;
}

function executeTurtleAction(action) {
  if (action.type === "pen_down") {
    state.turtle.penDown = true;
    addLog("落笔");
    return;
  }

  if (action.type === "pen_up") {
    state.turtle.penDown = false;
    addLog("抬笔");
    return;
  }

  if (action.type === "turtle_turn") {
    state.turtle.angle = normalizeAngle(state.turtle.angle + action.angle);
    addLog(turnActionLabel(action.angle));
    return;
  }

  if (action.type === "turtle_home") {
    state.turtle.x = 0.5;
    state.turtle.y = 0.5;
    state.turtle.angle = 0;
    addLog("画笔回到中心");
    return;
  }

  if (action.type === "turtle_color") {
    state.turtle.stroke = action.stroke || palette.black;
    addLog("更换画笔颜色");
    return;
  }

  if (action.type === "turtle_width") {
    state.turtle.strokeWidth = clamp(action.width || 4, 1, 14);
    addLog(`画笔线宽 ${state.turtle.strokeWidth}`);
    return;
  }

  if (action.type === "turtle_forward") {
    const { width, height } = canvasSize();
    const distance = Number(action.distance) || 80;
    const [dx, dy] = directionVector("forward");
    const from = { x: state.turtle.x, y: state.turtle.y };
    const to = {
      x: clamp(from.x + (dx * distance) / Math.max(1, width), 0.04, 0.96),
      y: clamp(from.y + (dy * distance) / Math.max(1, height), 0.04, 0.96)
    };

    if (state.turtle.penDown) {
      addStrokeObject([from, to], {
        label: "画笔线条",
        stroke: state.turtle.stroke,
        strokeWidth: state.turtle.strokeWidth
      });
    }

    state.turtle.x = to.x;
    state.turtle.y = to.y;
    addLog(`${distance >= 0 ? "前进" : "后退"}${Math.abs(distance)}像素`);
  }
}

async function executeAnimatedPathAction(action) {
  pushHistory();
  const draft = buildPathStroke(action);
  const object = addStrokeObject([draft.points[0]], draft.options);
  object.closed = false;

  for (let i = 1; i < draft.points.length; i += 1) {
    updateStrokePoints(object, draft.points.slice(0, i + 1), draft.closed && i === draft.points.length - 1);
    const tip = object.points.at(-1);
    state.turtle.x = tip.x;
    state.turtle.y = tip.y;
    updatePanels();
    draw();
    await wait(draft.delay);
  }

  state.actionTotal += 1;
  addLog(draft.log);
}

function createPathStroke(action) {
  const draft = buildPathStroke(action);
  addStrokeObject(draft.points, { ...draft.options, closed: draft.closed });
  const tip = draft.points.at(-1);
  state.turtle.x = tip.x;
  state.turtle.y = tip.y;
  addLog(draft.log);
}

function buildPathStroke(action) {
  const { width, height } = canvasSize();
  const stroke = action.stroke || state.turtle.stroke;
  const strokeWidth = action.strokeWidth || state.turtle.strokeWidth;

  if (action.path === "circle") {
    const center = resolvePathAnchor(action, "center");
    const radius = clamp(action.radius || 54, 8, Math.min(width, height) * 0.28);
    const points = [];
    for (let i = 0; i <= 48; i += 1) {
      const angle = (Math.PI * 2 * i) / 48;
      points.push(normalizeCanvasPoint({
        x: center.x + Math.cos(angle) * radius,
        y: center.y + Math.sin(angle) * radius
      }));
    }
    return {
      points,
      options: { label: "手绘圆", stroke, fill: action.fill || "transparent", strokeWidth },
      closed: true,
      delay: 10,
      log: "画一个圆"
    };
  }

  const start = resolvePathAnchor(action, "start");
  const end = pathEndPoint(start, action);
  const points = action.path === "curve"
    ? curvePoints(start, end, action)
    : linePoints(start, end);

  return {
    points,
    options: {
      label: action.path === "curve" ? "手绘曲线" : "手绘直线",
      stroke,
      fill: "transparent",
      strokeWidth
    },
    closed: false,
    delay: action.path === "curve" ? 12 : 14,
    log: action.path === "curve" ? "画一条曲线" : "画一条直线"
  };
}

function addStrokeObject(points, options = {}) {
  const boundedPoints = points.map((point) => ({
    x: clamp(point.x, 0.02, 0.98),
    y: clamp(point.y, 0.02, 0.98)
  }));
  const bounds = strokeBounds(boundedPoints);
  const object = {
    id: uid("stroke"),
    kind: "stroke",
    shape: "stroke",
    label: options.label || "笔画",
    x: bounds.x,
    y: bounds.y,
    w: bounds.w,
    h: bounds.h,
    points: boundedPoints,
    closed: Boolean(options.closed),
    stroke: options.stroke || state.turtle.stroke,
    fill: options.fill || "transparent",
    strokeWidth: options.strokeWidth || state.turtle.strokeWidth
  };
  state.objects.push(object);
  state.lastObjectId = object.id;
  return object;
}

function updateStrokePoints(object, points, closed = object.closed) {
  object.points = points.map((point) => ({
    x: clamp(point.x, 0.02, 0.98),
    y: clamp(point.y, 0.02, 0.98)
  }));
  object.closed = Boolean(closed);
  const bounds = strokeBounds(object.points);
  object.x = bounds.x;
  object.y = bounds.y;
  object.w = bounds.w;
  object.h = bounds.h;
}

function strokeBounds(points) {
  const { width, height } = canvasSize();
  const xs = points.map((point) => point.x * width);
  const ys = points.map((point) => point.y * height);
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);
  return {
    x: (minX + maxX) / 2,
    y: (minY + maxY) / 2,
    w: Math.max(1, maxX - minX),
    h: Math.max(1, maxY - minY)
  };
}

function normalizeCanvasPoint(point) {
  const { width, height } = canvasSize();
  return {
    x: clamp(point.x / Math.max(1, width), 0.02, 0.98),
    y: clamp(point.y / Math.max(1, height), 0.02, 0.98)
  };
}

function denormalizeCanvasPoint(point) {
  const { width, height } = canvasSize();
  return {
    x: point.x * width,
    y: point.y * height
  };
}

function resolvePathAnchor(action, usage) {
  const { width, height } = canvasSize();
  if (usage === "center" && action.position) {
    return toPoint(action.position, { width: (action.radius || 54) * 2, height: (action.radius || 54) * 2 });
  }

  const target = resolveTarget(action.target || "last_created");
  const anchor = action.anchor || "cursor";
  if (target && anchor !== "cursor") {
    return targetAnchorPoint(target, anchor);
  }

  return {
    x: clamp(state.turtle.x * width, 20, width - 20),
    y: clamp(state.turtle.y * height, 20, height - 20)
  };
}

function targetAnchorPoint(target, anchor) {
  const halfW = Math.max(1, target.w || 1) / 2;
  const halfH = Math.max(1, target.h || 1) / 2;
  const anchors = {
    center: { x: target.x, y: target.y },
    left: { x: target.x - halfW, y: target.y },
    right: { x: target.x + halfW, y: target.y },
    top: { x: target.x, y: target.y - halfH },
    bottom: { x: target.x, y: target.y + halfH }
  };
  if (anchor === "last_end" && target.kind === "stroke" && target.points?.length) {
    return denormalizeCanvasPoint(target.points.at(-1));
  }
  return anchors[anchor] || anchors.center;
}

function pathEndPoint(start, action) {
  const { width, height } = canvasSize();
  const distance = action.distance || 120;
  const [dx, dy] = hasActionAngle(action) ? vectorFromAngle(action.angle) : directionVector(action.direction);
  return {
    x: clamp(start.x + dx * distance, 20, width - 20),
    y: clamp(start.y + dy * distance, 20, height - 20)
  };
}

function linePoints(start, end) {
  const points = [];
  for (let i = 0; i <= 16; i += 1) {
    const t = i / 16;
    points.push(normalizeCanvasPoint({
      x: start.x + (end.x - start.x) * t,
      y: start.y + (end.y - start.y) * t
    }));
  }
  return points;
}

function curvePoints(start, end, action) {
  const direction = action.direction || "right";
  const distance = Math.max(24, action.distance || 120);
  const bendDirection = Number.isFinite(Number(action.bend)) ? Math.sign(Number(action.bend)) || 1 : 1;
  const bend = Math.min(90, Math.max(28, distance * 0.42)) * bendDirection;
  const [dx, dy] = hasActionAngle(action) ? vectorFromAngle(action.angle) : directionVector(direction);
  const perpendicular = { x: -dy * bend, y: dx * bend };
  const control = {
    x: (start.x + end.x) / 2 + perpendicular.x,
    y: (start.y + end.y) / 2 + perpendicular.y
  };
  const points = [];
  for (let i = 0; i <= 24; i += 1) {
    const t = i / 24;
    const inv = 1 - t;
    points.push(normalizeCanvasPoint({
      x: inv * inv * start.x + 2 * inv * t * control.x + t * t * end.x,
      y: inv * inv * start.y + 2 * inv * t * control.y + t * t * end.y
    }));
  }
  return points;
}

function normalizedPathPreviewPoint(action) {
  if (action.path === "circle") {
    return normalizeCanvasPoint(resolvePathAnchor(action, "center"));
  }
  const start = resolvePathAnchor(action, "start");
  return normalizeCanvasPoint(pathEndPoint(start, action));
}

function createShape(action) {
  const base = typeof action.size === "number" ? action.size : 120;
  const width = typeof action.width === "number" ? action.width : base;
  const height = typeof action.height === "number" ? action.height : base;
  const point = action.relativeTo
    ? resolveRelative(action.relativeTo, base)
    : toPoint(action.position || "center", { width, height });

  const object = {
    id: uid(action.shape),
    kind: "shape",
    shape: action.shape,
    label: shapeLabel(action.shape),
    customLabel: action.label || "",
    text: action.text || "",
    x: point.x,
    y: point.y,
    w: action.shape === "line" || action.shape === "arrow" ? base * 1.55 : width,
    h: action.shape === "line" || action.shape === "arrow" ? 18 : height,
    fill: action.fill || palette.blue,
    stroke: action.stroke || (action.shape === "line" || action.shape === "arrow" ? action.fill : "#1f2937"),
    strokeWidth: action.strokeWidth || 3,
    rotation: Number(action.rotation) || 0
  };
  state.objects.push(object);
  state.lastObjectId = object.id;
  addLog(`创建${displayObjectLabel(object)}`);
}

function updateObject(action) {
  const target = resolveTarget(action.target);
  if (!target) {
    addLog("没有可修改对象", "error");
    return;
  }
  if (target.kind === "stroke" && action.updates.fill) {
    target.stroke = action.updates.fill;
  } else {
    Object.assign(target, action.updates);
  }
  state.lastObjectId = target.id;
  addLog(`修改${target.label}`);
}

function resizeObject(action) {
  const target = resolveTarget(action.target);
  if (!target) {
    addLog("没有可缩放对象", "error");
    return;
  }
  if (target.kind === "stroke") {
    scaleStroke(target, action.scale);
    state.lastObjectId = target.id;
    addLog(`${action.scale > 1 ? "放大" : "缩小"}${target.label}`);
    return;
  }
  target.w *= action.scale;
  target.h *= action.scale;
  state.lastObjectId = target.id;
  addLog(`${action.scale > 1 ? "放大" : "缩小"}${target.label}`);
}

function moveObject(action) {
  const target = resolveTarget(action.target);
  if (!target) {
    addLog("没有可移动对象", "error");
    return;
  }
  const point = toPoint(action.position || "center", { width: target.w, height: target.h });
  if (target.kind === "stroke") {
    moveStroke(target, point);
    state.lastObjectId = target.id;
    addLog(`移动${target.label}`);
    return;
  }
  target.x = point.x;
  target.y = point.y;
  state.lastObjectId = target.id;
  addLog(`移动${target.label}`);
}

function scaleStroke(object, scale) {
  const { width, height } = canvasSize();
  const center = { x: object.x, y: object.y };
  object.points = object.points.map((point) => {
    const pixel = denormalizeCanvasPoint(point);
    return normalizeCanvasPoint({
      x: center.x + (pixel.x - center.x) * scale,
      y: center.y + (pixel.y - center.y) * scale
    });
  });
  const bounds = strokeBounds(object.points);
  object.x = clamp(bounds.x, 0, width);
  object.y = clamp(bounds.y, 0, height);
  object.w = bounds.w;
  object.h = bounds.h;
}

function moveStroke(object, point) {
  const { width, height } = canvasSize();
  const dx = (point.x - object.x) / Math.max(1, width);
  const dy = (point.y - object.y) / Math.max(1, height);
  object.points = object.points.map((current) => ({
    x: clamp(current.x + dx, 0.02, 0.98),
    y: clamp(current.y + dy, 0.02, 0.98)
  }));
  const bounds = strokeBounds(object.points);
  object.x = bounds.x;
  object.y = bounds.y;
  object.w = bounds.w;
  object.h = bounds.h;
}

function deleteObject(action) {
  const target = resolveTarget(action.target);
  if (!target) {
    addLog("没有可删除对象", "error");
    return;
  }
  state.objects = state.objects.filter((object) => object.id !== target.id);
  state.lastObjectId = state.objects.at(-1)?.id || null;
  addLog(`删除${target.label}`);
}

function undo() {
  if (!state.history.length) {
    addLog("没有可撤销操作", "error");
    return;
  }
  state.redo.push(snapshot());
  restore(state.history.pop());
  addLog("撤销上一步");
  updatePanels();
  draw();
}

function redo() {
  if (!state.redo.length) {
    addLog("没有可重做操作", "error");
    return;
  }
  state.history.push(snapshot());
  restore(state.redo.pop());
  addLog("重做上一步");
  updatePanels();
  draw();
}

function shapeLabel(shape) {
  const labels = {
    circle: "圆形",
    rect: "矩形",
    triangle: "三角形",
    line: "线条",
    arrow: "箭头",
    text: "文字"
  };
  return labels[shape] || "图形";
}

function draw() {
  syncCanvasResolution();
  const { width, height } = canvasSize();
  ctx.clearRect(0, 0, width, height);
  drawPaper(width, height);
  for (const object of state.objects) {
    drawObject(object);
  }
  drawTurtleCursor(width, height);
  drawPlanningCursor(width, height);
}

function drawPaper(width, height) {
  ctx.save();
  ctx.fillStyle = "#fffef9";
  ctx.fillRect(0, 0, width, height);
  ctx.strokeStyle = "rgba(148, 163, 184, 0.18)";
  ctx.lineWidth = 1;
  for (let x = 0; x < width; x += gridUnit) {
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, height);
    ctx.stroke();
  }
  for (let y = 0; y < height; y += gridUnit) {
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(width, y);
    ctx.stroke();
  }
  if (state.compositionGridVisible) {
    drawCompositionGrid(width, height);
  }
  ctx.restore();
}

function drawCompositionGrid(width, height) {
  const colWidth = width / gridColumns.length;
  const rowHeight = height / gridRows.length;

  ctx.save();
  ctx.strokeStyle = "rgba(31, 41, 55, 0.2)";
  ctx.lineWidth = 1.4;
  ctx.setLineDash([7, 8]);

  for (let i = 1; i < gridColumns.length; i += 1) {
    const x = i * colWidth;
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, height);
    ctx.stroke();
  }

  for (let i = 1; i < gridRows.length; i += 1) {
    const y = i * rowHeight;
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(width, y);
    ctx.stroke();
  }

  ctx.setLineDash([]);
  ctx.strokeStyle = "rgba(31, 41, 55, 0.18)";
  ctx.lineWidth = 1;
  ctx.strokeRect(0.5, 0.5, Math.max(1, width - 1), Math.max(1, height - 1));

  ctx.restore();
}

function drawObject(object) {
  ctx.save();
  if (object.kind === "stroke") {
    drawStroke(object);
    if (object.id === state.lastObjectId) {
      drawStrokeSelection(object);
    }
    ctx.restore();
    return;
  }

  ctx.translate(object.x, object.y);
  if (object.rotation) {
    ctx.rotate((object.rotation * Math.PI) / 180);
  }
  ctx.lineJoin = "round";
  ctx.lineCap = "round";
  if (object.kind === "shape") {
    drawShape(object);
  }
  if (object.id === state.lastObjectId) {
    drawSelection(object);
  }
  ctx.restore();
}

function drawStroke(object) {
  const { width, height } = canvasSize();
  if (!Array.isArray(object.points) || object.points.length < 2) return;
  ctx.strokeStyle = object.stroke || palette.black;
  ctx.lineWidth = object.strokeWidth || 4;
  ctx.lineJoin = "round";
  ctx.lineCap = "round";
  ctx.beginPath();
  object.points.forEach((point, index) => {
    const x = point.x * width;
    const y = point.y * height;
    if (index === 0) {
      ctx.moveTo(x, y);
    } else {
      ctx.lineTo(x, y);
    }
  });
  if (object.closed) {
    ctx.closePath();
  }
  if (object.closed && object.fill && object.fill !== "transparent") {
    ctx.fillStyle = object.fill;
    ctx.fill();
  }
  ctx.stroke();
}

function drawStrokeSelection(object) {
  ctx.save();
  ctx.strokeStyle = "rgba(37, 99, 235, 0.7)";
  ctx.setLineDash([6, 5]);
  ctx.lineWidth = 2;
  ctx.strokeRect(object.x - object.w / 2 - 8, object.y - object.h / 2 - 8, object.w + 16, object.h + 16);
  ctx.restore();
}

function drawTurtleCursor(width, height) {
  const x = state.turtle.x * width;
  const y = state.turtle.y * height;
  const angle = (state.turtle.angle * Math.PI) / 180;

  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(angle);
  ctx.fillStyle = state.turtle.penDown ? "#0f766e" : "#64748b";
  ctx.strokeStyle = "#1f2937";
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(16, 0);
  ctx.lineTo(-10, -9);
  ctx.lineTo(-5, 0);
  ctx.lineTo(-10, 9);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
  ctx.restore();
}

function drawPlanningCursor(width, height) {
  if (!state.drawCursor.active) return;
  const x = state.drawCursor.x * width;
  const y = state.drawCursor.y * height;

  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(-0.7);
  ctx.fillStyle = "#2563eb";
  ctx.strokeStyle = "#1f2937";
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(0, -18);
  ctx.lineTo(8, 10);
  ctx.lineTo(0, 16);
  ctx.lineTo(-8, 10);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
  ctx.beginPath();
  ctx.strokeStyle = "rgba(37, 99, 235, 0.35)";
  ctx.arc(0, 0, 18, 0, Math.PI * 2);
  ctx.stroke();
  ctx.restore();
}

function drawShape(object) {
  ctx.fillStyle = object.fill;
  ctx.strokeStyle = object.stroke;
  ctx.lineWidth = object.strokeWidth;

  if (object.shape === "circle") {
    ctx.beginPath();
    ctx.ellipse(0, 0, object.w / 2, object.h / 2, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
  }

  if (object.shape === "rect") {
    roundedRect(-object.w / 2, -object.h / 2, object.w, object.h, 18);
    ctx.fill();
    ctx.stroke();
  }

  if (object.shape === "triangle") {
    ctx.beginPath();
    ctx.moveTo(0, -object.h / 2);
    ctx.lineTo(object.w / 2, object.h / 2);
    ctx.lineTo(-object.w / 2, object.h / 2);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
  }

  if (object.shape === "line" || object.shape === "arrow") {
    ctx.beginPath();
    ctx.moveTo(-object.w / 2, 0);
    ctx.lineTo(object.w / 2, 0);
    ctx.stroke();
    if (object.shape === "arrow") {
      ctx.beginPath();
      ctx.moveTo(object.w / 2, 0);
      ctx.lineTo(object.w / 2 - 20, -12);
      ctx.moveTo(object.w / 2, 0);
      ctx.lineTo(object.w / 2 - 20, 12);
      ctx.stroke();
    }
  }

  if (object.shape === "text") {
    ctx.fillStyle = object.fill;
    ctx.font = "700 30px 'Microsoft YaHei', sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(object.text, 0, 0);
  }
}

function roundedRect(x, y, width, height, radius) {
  const r = Math.min(radius, Math.abs(width) / 2, Math.abs(height) / 2);
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + width - r, y);
  ctx.quadraticCurveTo(x + width, y, x + width, y + r);
  ctx.lineTo(x + width, y + height - r);
  ctx.quadraticCurveTo(x + width, y + height, x + width - r, y + height);
  ctx.lineTo(x + r, y + height);
  ctx.quadraticCurveTo(x, y + height, x, y + height - r);
  ctx.lineTo(x, y + r);
  ctx.quadraticCurveTo(x, y, x + r, y);
  ctx.closePath();
}

function drawSelection(object) {
  ctx.save();
  ctx.strokeStyle = "rgba(37, 99, 235, 0.7)";
  ctx.setLineDash([6, 5]);
  ctx.lineWidth = 2;
  ctx.strokeRect(-object.w / 2 - 8, -object.h / 2 - 8, object.w + 16, object.h + 16);
  ctx.restore();
}

function displayObjectLabel(object) {
  return object.customLabel || object.label || "对象";
}

function updatePanels() {
  objectCount.textContent = String(state.objects.length);
  actionCount.textContent = String(state.actionTotal);
  if (headingValue) headingValue.textContent = headingLabel();
  layerList.innerHTML = "";
  planList.innerHTML = "";

  if (!state.objects.length) {
    const empty = document.createElement("li");
    empty.textContent = "画布为空";
    layerList.appendChild(empty);
  } else {
    [...state.objects].reverse().forEach((object, index) => {
      const item = document.createElement("li");
      item.textContent = `${state.objects.length - index}. ${displayObjectLabel(object)}`;
      if (object.id === state.lastObjectId) {
        item.classList.add("is-active");
      }
      layerList.appendChild(item);
    });
  }

  if (!state.latestPlan.length) {
    const empty = document.createElement("li");
    empty.textContent = "等待可拆解的绘图口令";
    empty.classList.add("is-empty");
    planList.appendChild(empty);
    return;
  }

  state.latestPlan.forEach((step) => {
    const item = document.createElement("li");
    item.textContent = step;
    planList.appendChild(item);
  });
}

async function handleSpeech(text) {
  const cleaned = text.trim();
  if (!cleaned) return;
  const normalized = normalizeSpeechText(cleaned);
  if (normalized === state.lastFinalText) return;
  state.lastFinalText = normalized;
  transcriptText.textContent = cleaned === normalized ? cleaned : `${cleaned} -> ${normalized}`;
  setSpeechHint(cleaned === normalized ? "已识别语音，正在执行绘图指令。" : "已识别语音，并完成口令纠错。");
  const dsl = await parseCommandSmart(cleaned);
  await executeDsl(dsl);
}

async function checkLlmStatus() {
  try {
    const response = await fetch("/api/llm-status");
    if (!response.ok) {
      state.llmAvailable = false;
      return;
    }
    const status = await response.json();
    state.llmAvailable = Boolean(status.configured);
    state.llmProvider = status.provider || "OpenAI";
    if (status.configured) {
      addLog(`${state.llmProvider} 指令增强已连接：${status.model}`);
    }
  } catch (error) {
    state.llmAvailable = false;
  }
}

async function ensureMicAccess() {
  if (state.micReady) return true;

  if (!window.isSecureContext) {
    setSpeechHint("当前地址不是安全上下文。请改用 http://localhost:5173 或 http://127.0.0.1:5173 打开。", "error");
    addLog("麦克风需要安全上下文，建议使用 localhost 地址", "error");
    return false;
  }

  if (!navigator.mediaDevices?.getUserMedia) {
    setSpeechHint("当前浏览器不支持麦克风权限检测，请换 Chrome。", "error");
    addLog("浏览器不支持 getUserMedia", "error");
    return false;
  }

  try {
    setSpeechHint("正在请求麦克风权限，请在浏览器弹窗中选择允许。");
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    stream.getTracks().forEach((track) => track.stop());
    state.micReady = true;
    setSpeechHint("麦克风权限已允许，开始讲话即可。");
    return true;
  } catch (error) {
    const message = error?.name === "NotAllowedError"
      ? "浏览器麦克风权限被拒绝，请点击地址栏左侧权限图标重新允许。"
      : `麦克风不可用：${error?.message || error?.name || "未知错误"}`;
    setSpeechHint(message, "error");
    addLog(message, "error");
    return false;
  }
}

function speechErrorMessage(error) {
  const map = {
    "no-speech": "没有检测到语音，请靠近麦克风再试。",
    "audio-capture": "没有检测到可用麦克风，请检查系统输入设备。",
    "not-allowed": "浏览器拒绝了麦克风权限，请重新允许。",
    "network": "Chrome 语音识别服务暂时断开，请稍等后重新点麦克风。",
    "language-not-supported": "当前语音识别不支持中文。",
    "language-unavailable": "当前中文语音识别服务不可用。"
  };
  return map[error] || `语音识别错误：${error}`;
}

function handleNetworkSpeechError() {
  state.networkErrorCount += 1;
  state.lastNetworkErrorAt = Date.now();
  state.stopRequested = true;
  state.recognitionActive = false;
  clearSilenceTimer();
  clearResultTimer();
  clearRestartTimer();
  setListening(false);
  speechStatus.textContent = "需重启";
  setSpeechHint("Chrome 语音识别服务刚刚断开。请等 1-2 秒后重新点麦克风继续，已避免自动重试刷屏。", "warning");
  addLog("Chrome 语音服务断开，等待手动重启", "error");
}

function shouldAutoRestart(error) {
  return state.listening && !state.stopRequested && ["no-speech", "aborted"].includes(error);
}

function startRecognitionLoop() {
  if (!state.recognition || state.recognitionActive) return;
  clearRestartTimer();
  try {
    state.recognition.start();
  } catch (error) {
    const message = error?.name === "InvalidStateError"
      ? "语音识别正在启动，请稍等。"
      : `启动语音识别失败：${error?.message || error?.name || "未知错误"}`;
    setSpeechHint(message, "error");
    addLog(message, "error");
  }
}

function scheduleRecognitionRestart(reason = "继续监听") {
  if (!state.listening || state.stopRequested) return;
  clearRestartTimer();
  setSpeechHint(`${reason}，正在准备下一句。`);
  state.restartTimer = window.setTimeout(() => {
    startRecognitionLoop();
  }, 900);
}

function setupSpeech() {
  const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SpeechRecognition) {
    speechStatus.textContent = "不支持";
    listenButton.disabled = true;
    setSpeechHint("当前浏览器不支持 Web Speech API。请使用 Chrome，或后续接入云端 ASR。", "error");
    addLog("当前浏览器不支持 Web Speech API，建议使用 Chrome。", "error");
    return;
  }

  const recognition = new SpeechRecognition();
  recognition.lang = "zh-CN";
  recognition.continuous = false;
  recognition.interimResults = true;
  recognition.maxAlternatives = 5;

  recognition.onstart = () => {
    state.recognitionActive = true;
    state.stopRequested = false;
    setSpeechHint("正在监听，请说出绘图指令。");
    startSilenceTimer();
  };
  recognition.onaudiostart = () => {
    setSpeechHint("麦克风已开始采集声音。");
  };
  recognition.onsoundstart = () => {
    state.speechStarted = true;
    clearSilenceTimer();
    setSpeechHint("听到声音了，正在判断是否为语音。");
    startResultTimer();
  };
  recognition.onspeechstart = () => {
    state.speechStarted = true;
    clearSilenceTimer();
    setSpeechHint("听到语音了，正在识别文字。");
    startResultTimer();
  };
  recognition.onspeechend = () => {
    setSpeechHint("语音结束，等待识别结果。");
  };
  recognition.onnomatch = () => {
    setSpeechHint("听到了声音，但没有匹配出可用文字，请再说一遍。", "warning");
    addLog("听到声音但未识别出文字", "error");
  };
  recognition.onend = () => {
    state.recognitionActive = false;
    clearSilenceTimer();
    clearResultTimer();
    if (state.listening && !state.stopRequested) {
      scheduleRecognitionRestart("本句监听结束");
      return;
    }
    if (state.micReady && !state.listening) {
      setSpeechHint("监听已暂停，点击麦克风可重新开始。");
    }
  };
  recognition.onerror = (event) => {
    const message = speechErrorMessage(event.error);
    setSpeechHint(message, "error");
    addLog(message, "error");
    state.recognitionActive = false;
    clearSilenceTimer();
    clearResultTimer();
    if (event.error === "network") {
      handleNetworkSpeechError();
      return;
    }
    if (shouldAutoRestart(event.error)) {
      scheduleRecognitionRestart("没有识别到完整语音");
      return;
    }
    setListening(false);
  };
  recognition.onresult = (event) => {
    clearSilenceTimer();
    clearResultTimer();
    let interim = "";
    let finalText = "";
    for (let i = event.resultIndex; i < event.results.length; i += 1) {
      const result = event.results[i];
      const alternatives = Array.from(result).map((item) => item.transcript);
      const best = pickBestTranscript(alternatives);
      const text = best.raw || result[0].transcript;
      if (result.isFinal) {
        finalText += text;
        if (alternatives.length > 1) {
          addLog(`候选择优：${best.normalized || text}`);
        }
      } else {
        interim += text;
      }
    }
    if (finalText.trim()) {
      state.lastResultAt = Date.now();
      state.networkErrorCount = 0;
      handleSpeech(finalText);
    }
    if (interim) {
      transcriptText.textContent = interim;
      setSpeechHint("正在实时识别语音。");
    }
  };

  state.recognition = recognition;
}

function checkSpeechEnvironment() {
  const host = window.location.hostname;
  const userAgent = navigator.userAgent || "";
  const isEdge = userAgent.includes("Edg/");
  if (isEdge) {
    setSpeechHint("检测到 Edge。Edge 的浏览器语音识别在当前环境不稳定，Demo 建议使用 Chrome 打开 http://localhost:5173。", "warning");
    addLog("Edge 语音识别不稳定，建议使用 Chrome", "error");
    return;
  }

  if (host === "::" || host === "0.0.0.0" || host === "[::]") {
    setSpeechHint("当前地址可能影响浏览器语音识别。请手动打开 http://localhost:5173 后再点麦克风。", "warning");
    addLog("建议使用 http://localhost:5173 进行语音识别", "error");
    return;
  }

  if (!window.isSecureContext) {
    setSpeechHint("当前页面不是安全上下文，浏览器可能禁止麦克风。请使用 http://localhost:5173。", "error");
    addLog("当前页面不是安全上下文", "error");
  }
}

listenButton.addEventListener("click", async () => {
  if (!state.recognition) return;
  if (state.listening) {
    state.stopRequested = true;
    setListening(false);
    clearRestartTimer();
    if (state.recognitionActive) {
      try {
        state.recognition.stop();
      } catch (error) {
        addLog("语音识别已停止");
      }
    } else {
      setSpeechHint("监听已暂停，点击麦克风可重新开始。");
    }
  } else {
    const canUseMic = await ensureMicAccess();
    if (!canUseMic) return;
    state.stopRequested = false;
    setListening(true);
    state.lastFinalText = "";
    startRecognitionLoop();
  }
});

window.addEventListener("resize", resizeCanvas);

setupSpeech();
resizeCanvas();
updatePanels();
addLog("声绘板已就绪");
checkSpeechEnvironment();
void checkLlmStatus();

window.__voiceDrawTest = {
  run: handleSpeech,
  parse: parseCommand,
  parseSmart: parseCommandSmart,
  normalize: normalizeSpeechText,
  score: commandScore,
  pick: pickBestTranscript,
  getState: () => ({
    objects: state.objects,
    turtle: state.turtle,
    actionTotal: state.actionTotal,
    latestDsl: state.latestDsl
  })
};
