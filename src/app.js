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
const commandGrid = document.querySelector("#commandGrid");
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

const demoCommands = [
  "画一只小猫",
  "画一辆小汽车",
  "落笔",
  "向前走一百",
  "向右转九十度",
  "换成红色",
  "画一个蓝色圆形放在中间",
  "在 B2 画一个黄色圆形",
  "把它移到 C3",
  "隐藏坐标",
  "显示坐标",
  "在它右边画一个红色三角形",
  "把圆形变大一点",
  "在右上角画一个太阳",
  "下面画一棵树",
  "画一座房子",
  "画两朵云",
  "撤销上一步"
];

const gridColumns = ["A", "B", "C"];
const gridRows = ["1", "2", "3"];
const gridCells = gridColumns.flatMap((column) => gridRows.map((row) => `${column}${row}`));
const supportedShapes = ["circle", "rect", "triangle", "line", "arrow", "text"];
const supportedComposites = ["sun", "cloud", "tree", "house", "flower", "girl"];
const supportedTargets = ["last_created", ...supportedShapes, ...supportedComposites];
const supportedPositions = ["center", "left", "right", "top", "bottom", "top_left", "top_right", "bottom_left", "bottom_right", ...gridCells];
const supportedPlacements = ["left", "right", "top", "bottom"];
const supportedActions = [
  "create_shape",
  "create_composite",
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
  if (shapeFromText(normalized)) score += 8;
  if (compositeFromText(normalized)) score += 8;
  if (hasColorWord(normalized)) score += 3;
  if (positionFromText(normalized)) score += 3;
  if (/变大|放大|变小|缩小|改成|换成|移动|移到|删除|撤销|重做|清空/.test(normalized)) score += 5;
  if (/右边|左边|上面|下面|中间|左上|右上|左下|右下/.test(normalized)) score += 3;
  if (/圆|矩形|三角|线|箭头|太阳|云|树|房子|花朵|小女孩/.test(normalized)) score += 4;

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

function setupCommands() {
  commandGrid.innerHTML = "";
  for (const command of demoCommands) {
    const chip = document.createElement("div");
    chip.className = "command-chip";
    chip.textContent = command;
    commandGrid.appendChild(chip);
  }
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

function resizeCanvas() {
  const rect = canvas.getBoundingClientRect();
  const ratio = window.devicePixelRatio || 1;
  canvas.width = Math.max(1, Math.floor(rect.width * ratio));
  canvas.height = Math.max(1, Math.floor(rect.height * ratio));
  ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
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

function compositeFromText(text) {
  const normalized = normalizeSpeechText(text);
  if (/太阳|太陽/.test(normalized)) return "sun";
  if (/云|雲/.test(normalized)) return "cloud";
  if (/树|樹/.test(normalized)) return "tree";
  if (/房子|房屋|小屋/.test(normalized)) return "house";
  if (/花朵|小花|鲜花|一朵花|两朵花|二朵花|三朵花|朵花/.test(normalized)) return "flower";
  if (/女孩|小女孩|女生|女孩子/.test(normalized)) return "girl";
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

  const digits = { 零: 0, 一: 1, 幺: 1, 二: 2, 两: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9 };
  if (normalized.includes("一百")) return 100;
  if (normalized.includes("两百") || normalized.includes("二百")) return 200;
  if (normalized.includes("九十")) return 90;
  if (normalized.includes("八十")) return 80;
  if (normalized.includes("七十")) return 70;
  if (normalized.includes("六十")) return 60;
  if (normalized.includes("五十")) return 50;
  if (normalized.includes("四十")) return 40;
  if (normalized.includes("三十")) return 30;
  if (normalized.includes("二十") || normalized.includes("两十")) return 20;
  if (normalized.includes("十")) {
    const match = normalized.match(/([一二两三四五六七八九])?十([一二两三四五六七八九])?/);
    if (match) {
      const tens = match[1] ? digits[match[1]] : 1;
      const ones = match[2] ? digits[match[2]] : 0;
      return tens * 10 + ones;
    }
    return 10;
  }

  for (const [word, value] of Object.entries(digits)) {
    if (normalized.includes(word)) return value;
  }
  return fallback;
}

function targetFromText(text) {
  const normalized = normalizeSpeechText(text);
  if (/刚才|上一个|它|这个/.test(normalized)) return "last_created";
  if (/圆|圈/.test(normalized)) return "circle";
  if (/矩形|方/.test(normalized)) return "rect";
  if (/三角/.test(normalized)) return "triangle";
  if (/太阳/.test(normalized)) return "sun";
  if (/云/.test(normalized)) return "cloud";
  if (/树/.test(normalized)) return "tree";
  if (/房/.test(normalized)) return "house";
  if (/女孩/.test(normalized)) return "girl";
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
  if (/猫|小猫|猫咪/.test(normalized)) return catPlan();
  if (/汽车|小车|车子|轿车/.test(normalized)) return carPlan();
  return null;
}

function catPlan() {
  const orange = "#fb923c";
  return {
    plan: [
      "画一个圆形作为小猫的头",
      "在头顶画两个三角形耳朵",
      "画眼睛、鼻子和胡须",
      "在下方画身体",
      "在右侧画尾巴"
    ],
    actions: [
      { type: "create_shape", shape: "circle", fill: orange, position: { x: 0.5, y: 0.36 }, size: 120, label: "小猫头部" },
      { type: "create_shape", shape: "triangle", fill: orange, position: { x: 0.43, y: 0.25 }, size: 46, rotation: -18, label: "左耳" },
      { type: "create_shape", shape: "triangle", fill: orange, position: { x: 0.57, y: 0.25 }, size: 46, rotation: 18, label: "右耳" },
      { type: "create_shape", shape: "circle", fill: palette.black, position: { x: 0.47, y: 0.35 }, size: 15, label: "左眼" },
      { type: "create_shape", shape: "circle", fill: palette.black, position: { x: 0.53, y: 0.35 }, size: 15, label: "右眼" },
      { type: "create_shape", shape: "triangle", fill: palette.pink, position: { x: 0.5, y: 0.39 }, size: 18, rotation: 180, label: "鼻子" },
      { type: "create_shape", shape: "line", fill: palette.black, position: { x: 0.42, y: 0.4 }, size: 46, rotation: -8, label: "左胡须" },
      { type: "create_shape", shape: "line", fill: palette.black, position: { x: 0.42, y: 0.43 }, size: 46, rotation: 8, label: "左胡须" },
      { type: "create_shape", shape: "line", fill: palette.black, position: { x: 0.58, y: 0.4 }, size: 46, rotation: 8, label: "右胡须" },
      { type: "create_shape", shape: "line", fill: palette.black, position: { x: 0.58, y: 0.43 }, size: 46, rotation: -8, label: "右胡须" },
      { type: "create_shape", shape: "circle", fill: "#fdba74", position: { x: 0.5, y: 0.56 }, size: 100, label: "身体" },
      { type: "create_shape", shape: "line", fill: orange, position: { x: 0.61, y: 0.54 }, size: 80, rotation: -35, label: "尾巴" }
    ]
  };
}

function carPlan() {
  return {
    plan: [
      "画一个圆角矩形作为车身",
      "在车身上方画车窗",
      "画两个轮子",
      "补上车灯和地面线"
    ],
    actions: [
      { type: "create_shape", shape: "rect", fill: palette.blue, position: { x: 0.5, y: 0.55 }, size: 150, label: "车身" },
      { type: "create_shape", shape: "rect", fill: "#bfdbfe", position: { x: 0.5, y: 0.45 }, size: 76, label: "车窗" },
      { type: "create_shape", shape: "circle", fill: palette.black, position: { x: 0.42, y: 0.63 }, size: 38, label: "左轮" },
      { type: "create_shape", shape: "circle", fill: palette.black, position: { x: 0.58, y: 0.63 }, size: 38, label: "右轮" },
      { type: "create_shape", shape: "circle", fill: "#f8fafc", position: { x: 0.42, y: 0.63 }, size: 16, label: "轮毂" },
      { type: "create_shape", shape: "circle", fill: "#f8fafc", position: { x: 0.58, y: 0.63 }, size: 16, label: "轮毂" },
      { type: "create_shape", shape: "circle", fill: palette.yellow, position: { x: 0.64, y: 0.54 }, size: 18, label: "车灯" },
      { type: "create_shape", shape: "line", fill: palette.gray, position: { x: 0.5, y: 0.7 }, size: 180, label: "地面线" }
    ]
  };
}

function turtleCommandFromText(text) {
  const normalized = normalizeSpeechText(text);

  if (/落笔|下笔|开始画/.test(normalized)) return { actions: [{ type: "pen_down" }], plan: ["落下画笔，后续移动会留下线条"] };
  if (/抬笔|提笔|停止画/.test(normalized)) return { actions: [{ type: "pen_up" }], plan: ["抬起画笔，后续移动只改变画笔位置"] };
  if (/回到中心|回中心|回原点|回到原点/.test(normalized)) return { actions: [{ type: "turtle_home" }], plan: ["把画笔移动回画布中心"] };

  if (/左转|向左转/.test(normalized)) {
    const angle = numberFromText(normalized, 90);
    return { actions: [{ type: "turtle_turn", angle: -angle }], plan: [`向左转 ${angle} 度`] };
  }
  if (/右转|向右转/.test(normalized)) {
    const angle = numberFromText(normalized, 90);
    return { actions: [{ type: "turtle_turn", angle }], plan: [`向右转 ${angle} 度`] };
  }
  if (/向后|后退|倒退/.test(normalized)) {
    const distance = numberFromText(normalized, 80);
    return { actions: [{ type: "turtle_forward", distance: -distance }], plan: [`向后退 ${distance} 像素`] };
  }
  if (/向前|前进|往前|走/.test(normalized)) {
    const distance = numberFromText(normalized, 80);
    return { actions: [{ type: "turtle_forward", distance }], plan: [`向前走 ${distance} 像素`] };
  }
  if (/换成|改成|颜色/.test(normalized) && hasColorWord(normalized)) {
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

  const turtleCommand = turtleCommandFromText(normalized);
  if (turtleCommand) return turtleCommand;

  const plannedObject = plannedObjectFromText(normalized);
  if (plannedObject) return plannedObject;

  const segments = String(text || "")
    .toLowerCase()
    .split(/然后|再|并且|，|,|。|；|;/)
    .map((part) => normalizeSpeechText(part))
    .filter(Boolean);

  for (const segment of segments) {
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
      const content = segment.match(/(?:写上|写|文字|文本)(.+)/)?.[1] || "Voice";
      actions.push({
        type: "create_shape",
        shape: "text",
        text: content.replace(/放在|放到|在.+/, ""),
        fill: palette[colorFromText(segment, "black")],
        position: positionFromText(segment) || "center",
        size: "medium"
      });
      continue;
    }

    const composite = compositeFromText(segment);
    const shape = shapeFromText(segment);
    const count = countFromText(segment);
    const position = positionFromText(segment);
    const placement = relativePlacement(segment);
    const fill = palette[colorFromText(segment, composite === "tree" ? "green" : "blue")];

    if (composite) {
      for (let i = 0; i < count; i += 1) {
        actions.push({
          type: "create_composite",
          object: composite,
          fill,
          position: position || defaultCompositePosition(composite, i, count),
          relativeTo: !position && placement ? { target: "last_created", placement } : null,
          size: sizeFromText(segment, defaultCompositeSize(composite))
        });
      }
      continue;
    }

    if (shape) {
      for (let i = 0; i < count; i += 1) {
        actions.push({
          type: "create_shape",
          shape,
          fill,
          stroke: "#1f2937",
          strokeWidth: 3,
          position: position || defaultShapePosition(i, count),
          relativeTo: !position && placement ? { target: "last_created", placement } : null,
          size: sizeFromText(segment, 120),
          style: "cute_flat"
        });
      }
    }
  }

  if (!actions.length) {
    return {
      clarification: "我可以先画基础图形、太阳、云、树、房子、花和小女孩。"
    };
  }

  return { actions };
}

function isExecutableDsl(dsl) {
  return Array.isArray(dsl?.actions) && dsl.actions.length > 0;
}

function shouldUseLlm(text, localDsl) {
  if (state.llmInFlight || state.llmAvailable === false) return false;
  if (Array.isArray(localDsl?.plan) && localDsl.plan.length) return false;
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
    const distance = Number(action.distance);
    return {
      type: "turtle_forward",
      distance: Number.isFinite(distance) ? clamp(distance, -260, 260) : 80
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
      strokeWidth: 3,
      position: sanitizePosition(action.position) || "center",
      relativeTo: sanitizeRelativeTo(action.relativeTo),
      size: Number.isFinite(size) ? clamp(size, 48, 260) : 120,
      rotation: Number.isFinite(Number(action.rotation)) ? clamp(Number(action.rotation), -360, 360) : 0,
      label: String(action.label || "").slice(0, 20),
      style: "cute_flat"
    };
  }

  if (action.type === "create_composite") {
    const object = supportedComposites.includes(action.object) ? action.object : null;
    if (!object) return null;
    const size = Number(action.size);
    return {
      type: "create_composite",
      object,
      fill: normalizeFill(action.fill, object === "tree" ? palette.green : palette.pink),
      position: sanitizePosition(action.position) || defaultCompositePosition(object, 0, 1),
      relativeTo: sanitizeRelativeTo(action.relativeTo),
      size: Number.isFinite(size) ? clamp(size, 64, 280) : defaultCompositeSize(object)
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

function llmContext() {
  return {
    objectCount: state.objects.length,
    lastObject: state.objects.find((object) => object.id === state.lastObjectId) || null,
    objects: state.objects.map((object) => ({
      id: object.id,
      kind: object.kind,
      shape: object.shape || null,
      object: object.object || null,
      label: object.label,
      position: { x: Math.round(object.x), y: Math.round(object.y) }
    })).slice(-12),
    supportedShapes,
    supportedComposites,
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
  setSpeechHint("复杂口令正在交给 DeepSeek 拆解，稍等一下。");

  try {
    const result = await fetchLlmCommand(text);
    state.llmAvailable = true;
    state.llmProvider = result.provider || "DeepSeek";
    const dsl = sanitizeDsl(result.dsl || result);
    if (isExecutableDsl(dsl)) {
      addLog(`${state.llmProvider} 已拆解复杂口令`);
      return { ...dsl, source: "deepseek_llm" };
    }
    return dsl;
  } catch (error) {
    if (error.status === 404 || error.status === 503) {
      state.llmAvailable = false;
    }
    addLog(`DeepSeek 解析不可用，已回退本地规则：${error.message}`, "error");
    setSpeechHint("DeepSeek 解析暂不可用，已使用本地规则继续执行。", "warning");
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

function defaultCompositePosition(type, index, total) {
  const defaults = {
    sun: "top_right",
    cloud: { x: 0.34 + index * 0.22, y: 0.22 },
    tree: "bottom_right",
    house: "bottom_left",
    flower: { x: 0.36 + index * 0.12, y: 0.78 },
    girl: "bottom"
  };
  return defaults[type] || defaultShapePosition(index, total);
}

function defaultCompositeSize(type) {
  const defaults = {
    sun: 96,
    cloud: 130,
    tree: 170,
    house: 190,
    flower: 120,
    girl: 190
  };
  return defaults[type] || 140;
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

function executeDsl(dsl) {
  if (dsl.clarification) {
    addLog(dsl.clarification, "error");
    return;
  }

  state.latestDsl = dsl;
  state.latestPlan = Array.isArray(dsl.plan) ? dsl.plan : [];
  dslOutput.textContent = JSON.stringify(dsl, null, 2);

  const actions = Array.isArray(dsl.actions) ? dsl.actions : [];
  if (!actions.length) {
    addLog("没有可执行的绘图动作", "error");
    return;
  }

  for (const action of actions) {
    executeAction(action);
  }

  updatePanels();
  draw();
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

  pushHistory();

  if (action.type === "create_shape") {
    createShape(action);
  } else if (action.type === "create_composite") {
    createComposite(action);
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
    state.turtle.angle = (state.turtle.angle + action.angle + 360) % 360;
    addLog(`${action.angle >= 0 ? "右转" : "左转"}${Math.abs(action.angle)}度`);
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
    const angle = (state.turtle.angle * Math.PI) / 180;
    const from = { x: state.turtle.x, y: state.turtle.y };
    const to = {
      x: clamp(from.x + (Math.cos(angle) * distance) / Math.max(1, width), 0.04, 0.96),
      y: clamp(from.y + (Math.sin(angle) * distance) / Math.max(1, height), 0.04, 0.96)
    };

    if (state.turtle.penDown) {
      const object = {
        id: uid("stroke"),
        kind: "stroke",
        label: "画笔线条",
        x: 0,
        y: 0,
        w: 0,
        h: 0,
        points: [from, to],
        stroke: state.turtle.stroke,
        strokeWidth: state.turtle.strokeWidth
      };
      state.objects.push(object);
      state.lastObjectId = object.id;
    }

    state.turtle.x = to.x;
    state.turtle.y = to.y;
    addLog(`${distance >= 0 ? "前进" : "后退"}${Math.abs(distance)}像素`);
  }
}

function createShape(action) {
  const base = typeof action.size === "number" ? action.size : 120;
  const point = action.relativeTo
    ? resolveRelative(action.relativeTo, base)
    : toPoint(action.position || "center", { width: base, height: base });

  const object = {
    id: uid(action.shape),
    kind: "shape",
    shape: action.shape,
    label: shapeLabel(action.shape),
    customLabel: action.label || "",
    text: action.text || "",
    x: point.x,
    y: point.y,
    w: action.shape === "line" || action.shape === "arrow" ? base * 1.55 : base,
    h: action.shape === "line" || action.shape === "arrow" ? 18 : base,
    fill: action.fill || palette.blue,
    stroke: action.stroke || (action.shape === "line" || action.shape === "arrow" ? action.fill : "#1f2937"),
    strokeWidth: action.strokeWidth || 3,
    rotation: Number(action.rotation) || 0
  };
  state.objects.push(object);
  state.lastObjectId = object.id;
  addLog(`创建${displayObjectLabel(object)}`);
}

function createComposite(action) {
  const base = typeof action.size === "number" ? action.size : defaultCompositeSize(action.object);
  const point = action.relativeTo
    ? resolveRelative(action.relativeTo, base)
    : toPoint(action.position || defaultCompositePosition(action.object, 0, 1), { width: base, height: base });
  const object = {
    id: uid(action.object),
    kind: "composite",
    object: action.object,
    label: compositeLabel(action.object),
    x: point.x,
    y: point.y,
    w: compositeWidth(action.object, base),
    h: compositeHeight(action.object, base),
    fill: action.fill || palette.green,
    stroke: "#1f2937",
    strokeWidth: 3
  };
  state.objects.push(object);
  state.lastObjectId = object.id;
  addLog(`创建${object.label}`);
}

function updateObject(action) {
  const target = resolveTarget(action.target);
  if (!target) {
    addLog("没有可修改对象", "error");
    return;
  }
  Object.assign(target, action.updates);
  state.lastObjectId = target.id;
  addLog(`修改${target.label}`);
}

function resizeObject(action) {
  const target = resolveTarget(action.target);
  if (!target) {
    addLog("没有可缩放对象", "error");
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
  target.x = point.x;
  target.y = point.y;
  state.lastObjectId = target.id;
  addLog(`移动${target.label}`);
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

function compositeLabel(type) {
  const labels = {
    sun: "太阳",
    cloud: "云朵",
    tree: "树",
    house: "房子",
    flower: "花",
    girl: "小女孩"
  };
  return labels[type] || "组合对象";
}

function compositeWidth(type, base) {
  if (type === "house") return base * 1.18;
  if (type === "cloud") return base * 1.45;
  if (type === "girl") return base * 0.78;
  return base;
}

function compositeHeight(type, base) {
  if (type === "house") return base * 0.95;
  if (type === "cloud") return base * 0.72;
  if (type === "girl") return base * 1.18;
  return base;
}

function draw() {
  const { width, height } = canvasSize();
  ctx.clearRect(0, 0, width, height);
  drawPaper(width, height);
  for (const object of state.objects) {
    drawObject(object);
  }
  drawTurtleCursor(width, height);
}

function drawPaper(width, height) {
  ctx.save();
  ctx.fillStyle = "#fffef9";
  ctx.fillRect(0, 0, width, height);
  ctx.strokeStyle = "rgba(148, 163, 184, 0.18)";
  ctx.lineWidth = 1;
  for (let x = 0; x < width; x += 34) {
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, height);
    ctx.stroke();
  }
  for (let y = 0; y < height; y += 34) {
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
  ctx.strokeStyle = "rgba(31, 41, 55, 0.28)";
  ctx.lineWidth = 1;
  ctx.strokeRect(0.5, 0.5, Math.max(1, width - 1), Math.max(1, height - 1));

  for (let col = 0; col < gridColumns.length; col += 1) {
    drawGridBadge(gridColumns[col], col * colWidth + colWidth / 2, 17, "center");
  }

  for (let row = 0; row < gridRows.length; row += 1) {
    drawGridBadge(gridRows[row], 17, row * rowHeight + rowHeight / 2, "center");
  }

  for (let row = 0; row < gridRows.length; row += 1) {
    for (let col = 0; col < gridColumns.length; col += 1) {
      drawGridBadge(
        `${gridColumns[col]}${gridRows[row]}`,
        col * colWidth + 18,
        row * rowHeight + 34,
        "left",
        true
      );
    }
  }

  ctx.restore();
}

function drawGridBadge(label, x, y, align = "center", subtle = false) {
  ctx.save();
  ctx.font = "700 12px 'Segoe UI', sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  const width = ctx.measureText(label).width + 12;
  const height = 22;
  const left = align === "center" ? x - width / 2 : x;
  const top = y - height / 2;

  ctx.fillStyle = subtle ? "rgba(255, 255, 255, 0.48)" : "rgba(255, 255, 255, 0.82)";
  ctx.strokeStyle = subtle ? "rgba(100, 116, 139, 0.16)" : "rgba(100, 116, 139, 0.26)";
  ctx.lineWidth = 1;
  roundedRect(left, top, width, height, 7);
  ctx.fill();
  ctx.stroke();

  ctx.fillStyle = subtle ? "rgba(100, 116, 139, 0.66)" : "#475569";
  ctx.fillText(label, left + width / 2, y + 0.5);
  ctx.restore();
}

function drawObject(object) {
  ctx.save();
  ctx.translate(object.x, object.y);
  if (object.rotation) {
    ctx.rotate((object.rotation * Math.PI) / 180);
  }
  ctx.lineJoin = "round";
  ctx.lineCap = "round";
  if (object.kind === "stroke") {
    drawStroke(object);
  } else if (object.kind === "shape") {
    drawShape(object);
  } else {
    drawComposite(object);
  }
  if (object.id === state.lastObjectId && object.kind !== "stroke") {
    drawSelection(object);
  }
  ctx.restore();
}

function drawStroke(object) {
  const { width, height } = canvasSize();
  if (!Array.isArray(object.points) || object.points.length < 2) return;
  ctx.strokeStyle = object.stroke || palette.black;
  ctx.lineWidth = object.strokeWidth || 4;
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
  ctx.stroke();
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

function drawComposite(object) {
  const map = {
    sun: drawSun,
    cloud: drawCloud,
    tree: drawTree,
    house: drawHouse,
    flower: drawFlower,
    girl: drawGirl
  };
  const fn = map[object.object];
  if (fn) fn(object);
}

function drawSun(object) {
  const r = object.w * 0.28;
  ctx.strokeStyle = "#1f2937";
  ctx.lineWidth = object.strokeWidth;
  for (let i = 0; i < 12; i += 1) {
    const angle = (Math.PI * 2 * i) / 12;
    ctx.beginPath();
    ctx.moveTo(Math.cos(angle) * (r + 12), Math.sin(angle) * (r + 12));
    ctx.lineTo(Math.cos(angle) * (r + 28), Math.sin(angle) * (r + 28));
    ctx.stroke();
  }
  ctx.fillStyle = palette.yellow;
  ctx.beginPath();
  ctx.arc(0, 0, r, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();
  drawFace(0, 0, r * 0.85);
}

function drawCloud(object) {
  ctx.fillStyle = "#f8fafc";
  ctx.strokeStyle = "#1f2937";
  ctx.lineWidth = object.strokeWidth;
  const w = object.w;
  const h = object.h;
  ctx.beginPath();
  ctx.ellipse(-w * 0.24, h * 0.05, w * 0.22, h * 0.3, 0, 0, Math.PI * 2);
  ctx.ellipse(-w * 0.04, -h * 0.08, w * 0.26, h * 0.38, 0, 0, Math.PI * 2);
  ctx.ellipse(w * 0.24, h * 0.03, w * 0.24, h * 0.32, 0, 0, Math.PI * 2);
  ctx.rect(-w * 0.34, h * 0.02, w * 0.7, h * 0.3);
  ctx.fill("nonzero");
  ctx.stroke();
}

function drawTree(object) {
  const w = object.w;
  const h = object.h;
  ctx.fillStyle = "#a16207";
  ctx.strokeStyle = "#1f2937";
  ctx.lineWidth = object.strokeWidth;
  roundedRect(-w * 0.12, -h * 0.02, w * 0.24, h * 0.48, 10);
  ctx.fill();
  ctx.stroke();

  ctx.fillStyle = palette.green;
  ctx.beginPath();
  ctx.arc(-w * 0.2, -h * 0.22, w * 0.26, 0, Math.PI * 2);
  ctx.arc(w * 0.08, -h * 0.32, w * 0.3, 0, Math.PI * 2);
  ctx.arc(w * 0.26, -h * 0.12, w * 0.24, 0, Math.PI * 2);
  ctx.arc(-w * 0.02, -h * 0.06, w * 0.28, 0, Math.PI * 2);
  ctx.fill("nonzero");
  ctx.stroke();
}

function drawHouse(object) {
  const w = object.w;
  const h = object.h;
  ctx.strokeStyle = "#1f2937";
  ctx.lineWidth = object.strokeWidth;

  ctx.fillStyle = "#fde68a";
  roundedRect(-w * 0.36, -h * 0.02, w * 0.72, h * 0.5, 12);
  ctx.fill();
  ctx.stroke();

  ctx.fillStyle = "#f87171";
  ctx.beginPath();
  ctx.moveTo(-w * 0.43, -h * 0.03);
  ctx.lineTo(0, -h * 0.42);
  ctx.lineTo(w * 0.43, -h * 0.03);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();

  ctx.fillStyle = "#60a5fa";
  roundedRect(-w * 0.26, h * 0.08, w * 0.18, h * 0.16, 6);
  ctx.fill();
  ctx.stroke();
  roundedRect(w * 0.1, h * 0.08, w * 0.18, h * 0.16, 6);
  ctx.fill();
  ctx.stroke();

  ctx.fillStyle = "#fb923c";
  roundedRect(-w * 0.08, h * 0.18, w * 0.16, h * 0.28, 7);
  ctx.fill();
  ctx.stroke();
}

function drawFlower(object) {
  const w = object.w;
  const h = object.h;
  ctx.strokeStyle = "#1f2937";
  ctx.lineWidth = object.strokeWidth;
  ctx.fillStyle = palette.green;
  ctx.beginPath();
  ctx.moveTo(0, h * 0.38);
  ctx.lineTo(0, -h * 0.08);
  ctx.stroke();
  ctx.beginPath();
  ctx.ellipse(-w * 0.1, h * 0.1, w * 0.1, h * 0.05, -0.5, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();

  ctx.fillStyle = object.fill || palette.pink;
  for (let i = 0; i < 6; i += 1) {
    const angle = (Math.PI * 2 * i) / 6;
    ctx.beginPath();
    ctx.ellipse(Math.cos(angle) * w * 0.16, -h * 0.18 + Math.sin(angle) * h * 0.16, w * 0.1, h * 0.15, angle, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
  }
  ctx.fillStyle = palette.yellow;
  ctx.beginPath();
  ctx.arc(0, -h * 0.18, w * 0.09, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();
}

function drawGirl(object) {
  const w = object.w;
  const h = object.h;
  ctx.strokeStyle = "#1f2937";
  ctx.lineWidth = object.strokeWidth;

  ctx.fillStyle = "#111827";
  ctx.beginPath();
  ctx.ellipse(0, -h * 0.31, w * 0.38, h * 0.2, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();

  ctx.fillStyle = "#fde2c2";
  ctx.beginPath();
  ctx.ellipse(0, -h * 0.29, w * 0.28, h * 0.17, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();

  ctx.fillStyle = object.fill || palette.red;
  ctx.beginPath();
  ctx.moveTo(0, -h * 0.1);
  ctx.lineTo(w * 0.34, h * 0.26);
  ctx.lineTo(-w * 0.34, h * 0.26);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();

  ctx.beginPath();
  ctx.moveTo(-w * 0.24, 0);
  ctx.lineTo(-w * 0.45, h * 0.14);
  ctx.moveTo(w * 0.24, 0);
  ctx.lineTo(w * 0.45, h * 0.14);
  ctx.moveTo(-w * 0.13, h * 0.26);
  ctx.lineTo(-w * 0.16, h * 0.43);
  ctx.moveTo(w * 0.13, h * 0.26);
  ctx.lineTo(w * 0.16, h * 0.43);
  ctx.stroke();

  drawFace(0, -h * 0.29, w * 0.2);

  ctx.fillStyle = palette.pink;
  ctx.beginPath();
  ctx.moveTo(w * 0.18, -h * 0.45);
  ctx.lineTo(w * 0.34, -h * 0.52);
  ctx.lineTo(w * 0.34, -h * 0.38);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(w * 0.18, -h * 0.45);
  ctx.lineTo(w * 0.02, -h * 0.52);
  ctx.lineTo(w * 0.02, -h * 0.38);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
}

function drawFace(x, y, r) {
  ctx.save();
  ctx.translate(x, y);
  ctx.fillStyle = "#1f2937";
  ctx.beginPath();
  ctx.arc(-r * 0.32, -r * 0.12, Math.max(2.4, r * 0.08), 0, Math.PI * 2);
  ctx.arc(r * 0.32, -r * 0.12, Math.max(2.4, r * 0.08), 0, Math.PI * 2);
  ctx.fill();
  ctx.beginPath();
  ctx.strokeStyle = "#1f2937";
  ctx.lineWidth = Math.max(2, r * 0.08);
  ctx.arc(0, r * 0.08, r * 0.34, 0.15, Math.PI - 0.15);
  ctx.stroke();
  ctx.restore();
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
  executeDsl(dsl);
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
    state.llmProvider = status.provider || "DeepSeek";
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

setupCommands();
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
    actionTotal: state.actionTotal,
    latestDsl: state.latestDsl
  })
};
