// Account appearance is data, never user-provided CSS or HTML.  The UI may only
// use IDs from this file to build kp-skin-* and kp-effect-* class names.

export const SKINS = [
  { id: "classic", label: "Классика", description: "Спокойное стекло и золотая кромка", className: "kp-skin-classic" },
  { id: "carbon", label: "Карбон", description: "Тонкая фактура углеволокна", className: "kp-skin-carbon" },
  { id: "ingot", label: "Слиток", description: "Матовый графит и фаска", className: "kp-skin-ingot" },
  { id: "data", label: "Датавиз", description: "Акцент на аналитике и графиках", className: "kp-skin-data" },
  { id: "foil", label: "Фольга", description: "Лёгкое тиснение на тёмном поле", className: "kp-skin-foil" },
  { id: "neon", label: "Неон", description: "Светящийся тонкий контур", className: "kp-skin-neon" },
  { id: "holo", label: "Голография", description: "Сдержанный иридесцентный слой", className: "kp-skin-holo" },
  { id: "marble", label: "Мрамор", description: "Минеральные золотые жилы", className: "kp-skin-marble" },
  { id: "dust", label: "Звёздная пыль", description: "Редкие световые точки", className: "kp-skin-dust" },
  { id: "graphite", label: "Графит", description: "Нейтральный плотный тёмный слой", className: "kp-skin-graphite" },
  { id: "linen", label: "Лён", description: "Мягкая текстура без лишнего блеска", className: "kp-skin-linen" },
  { id: "obsidian", label: "Обсидиан", description: "Чёрное стекло с глубиной", className: "kp-skin-obsidian" },
  { id: "copper", label: "Медь", description: "Тёплый металлический акцент", className: "kp-skin-copper" },
  { id: "aurora", label: "Аврора", description: "Холодный свет за контентом", className: "kp-skin-aurora" },
  { id: "paper", label: "Чертёж", description: "Контрастная сетка для рабочих данных", className: "kp-skin-paper" },
];

export const EFFECTS = [
  { id: "none", label: "Статично", description: "Без анимации", className: "kp-effect-none" },
  { id: "glow", label: "Свечение", description: "Акцентный ореол", className: "kp-effect-glow" },
  { id: "shimmer", label: "Блик", description: "Медленный световой проход", className: "kp-effect-shimmer" },
  { id: "pulse", label: "Дыхание", description: "Мягкая пульсация контура", className: "kp-effect-pulse" },
  { id: "lift", label: "Левитация", description: "Подъём при наведении", className: "kp-effect-lift" },
  { id: "tilt", label: "Наклон 3D", description: "Перспектива за курсором", className: "kp-effect-tilt" },
  { id: "spark", label: "Спарклайн", description: "Графический акцент", className: "kp-effect-spark" },
  { id: "flip", label: "Переворот", description: "Смена акцента по нажатию", className: "kp-effect-flip" },
  { id: "border-flow", label: "Живая кромка", description: "Движение по рамке", className: "kp-effect-border-flow" },
  { id: "grain", label: "Зерно", description: "Неподвижная плёночная фактура", className: "kp-effect-grain" },
  { id: "breathe", label: "Атмосфера", description: "Медленное изменение фона", className: "kp-effect-breathe" },
  { id: "spotlight", label: "Прожектор", description: "Свет под указателем", className: "kp-effect-spotlight" },
  { id: "scan", label: "Сканирование", description: "Тонкая аналитическая линия", className: "kp-effect-scan" },
  { id: "bloom", label: "Расцвет", description: "Мягкое появление акцента", className: "kp-effect-bloom" },
  { id: "wave", label: "Волна", description: "Деликатная волна фона", className: "kp-effect-wave" },
];

// Every entry below maps to a rendered, recognisable zone.  Keeping this list
// narrow and explicit is important: the picker must never offer an override
// that has no visible target in the workspace.
export const PANEL_IDS = Object.freeze({
  dashboardKpis: "dashboard.kpis",
  dashboardAttention: "dashboard.attention",
  dashboardFinance: "dashboard.finance",
  dashboardProjects: "dashboard.projects",
  projectsList: "projects.list",
  financeSummary: "finance.summary",
  financeCategories: "finance.categories",
  financeTransactions: "finance.transactions",
  tasksBoard: "tasks.board",
  tasksList: "tasks.list",
  adminUsers: "admin.users",
  adminStats: "admin.stats",
  adminActivity: "admin.activity",
});

export const DEFAULT_APPEARANCE = Object.freeze({
  skinId: "classic",
  effectId: "none",
  panelOverrides: Object.freeze({}),
  selfTransferNames: Object.freeze([]),
});

const SKIN_IDS = new Set(SKINS.map(({ id }) => id));
const EFFECT_IDS = new Set(EFFECTS.map(({ id }) => id));
const PANEL_ID_SET = new Set(Object.values(PANEL_IDS));
const ADMIN_PANEL_IDS = new Set([PANEL_IDS.adminUsers, PANEL_IDS.adminStats, PANEL_IDS.adminActivity]);

const STATIC_EFFECTS = ["none", "grain"];
const MOTION_EFFECTS = ["glow", "shimmer", "pulse", "lift", "spark", "flip", "border-flow", "breathe", "spotlight", "scan", "bloom", "wave"];

// A deliberately conservative relation: interaction-heavy 3D is enabled only
// on skins that retain enough contrast and visual depth for it.
const PAIRS_BY_SKIN = Object.freeze({
  classic: ["none", "glow", "shimmer", "lift", "grain", "bloom"],
  carbon: ["none", "glow", "lift", "grain", "scan", "bloom"],
  ingot: ["none", "glow", "shimmer", "pulse", "lift", "border-flow", "bloom"],
  data: ["none", "spark", "scan", "spotlight", "lift", "grain"],
  foil: ["none", "shimmer", "glow", "lift", "grain"],
  neon: ["none", "glow", "pulse", "breathe", "lift", "wave"],
  holo: ["none", "shimmer", "wave", "breathe", "lift", "grain"],
  marble: ["none", "glow", "shimmer", "pulse", "tilt", "lift", "bloom"],
  dust: ["none", "pulse", "glow", "wave", "breathe", "grain"],
  graphite: ["none", "glow", "lift", "grain", "scan", "bloom"],
  linen: ["none", "grain", "bloom", "lift"],
  obsidian: ["none", "glow", "shimmer", "tilt", "lift", "spotlight", "bloom"],
  copper: ["none", "glow", "shimmer", "pulse", "lift", "border-flow"],
  aurora: ["none", "breathe", "wave", "glow", "lift", "bloom"],
  paper: ["none", "grain", "scan", "flip", "lift", "bloom"],
});

function copyDefault() {
  return { skinId: DEFAULT_APPEARANCE.skinId, effectId: DEFAULT_APPEARANCE.effectId, panelOverrides: {}, selfTransferNames: [] };
}

function readPanelOverrides(value) {
  if (!value) return {};
  if (typeof value === "string") {
    try { return JSON.parse(value); } catch { return {}; }
  }
  return typeof value === "object" && !Array.isArray(value) ? value : {};
}

function readPair(value, fallback) {
  const skinId = value?.skinId ?? value?.skin_id ?? value?.global_skin_id;
  const effectId = value?.effectId ?? value?.effect_id ?? value?.global_effect_id;
  return isAllowedPair(skinId, effectId) ? { skinId, effectId } : fallback;
}

export function isAllowedPair(skinId, effectId) {
  return SKIN_IDS.has(skinId) && EFFECT_IDS.has(effectId) && (PAIRS_BY_SKIN[skinId] || []).includes(effectId);
}

export function getAllowedEffects(skinId) {
  const allowed = new Set(PAIRS_BY_SKIN[skinId] || []);
  return EFFECTS.filter(({ id }) => allowed.has(id));
}

export function filterAppearancePanelsForRole(panels, role) {
  if (!Array.isArray(panels)) return [];
  return role === "admin" ? panels : panels.filter(({ id }) => !ADMIN_PANEL_IDS.has(id));
}

export function shouldUseLegacyCardTilt(className = "") {
  return !String(className).split(/\s+/).includes("kp-appearance-surface");
}

export function sanitizeAppearance(raw) {
  const global = readPair(raw, { skinId: DEFAULT_APPEARANCE.skinId, effectId: DEFAULT_APPEARANCE.effectId });
  const panelOverrides = {};
  const candidateOverrides = readPanelOverrides(raw?.panelOverrides ?? raw?.panel_overrides);

  Object.entries(candidateOverrides).forEach(([panelId, candidate]) => {
    if (!PANEL_ID_SET.has(panelId)) return;
    const pair = readPair(candidate, null);
    if (pair) panelOverrides[panelId] = pair;
  });

  const rawNames = raw?.selfTransferNames ?? raw?.self_transfer_names;
  const selfTransferNames = Array.isArray(rawNames)
    ? [...new Set(rawNames.map((name) => typeof name === "string" ? name.trim() : "").filter((name) => name.length >= 2))].slice(0, 12)
    : [];
  return { ...global, panelOverrides, selfTransferNames };
}

export function deserializeAppearance(raw) {
  return sanitizeAppearance(raw);
}

export function serializeAppearance(preferences) {
  const safe = sanitizeAppearance(preferences);
  return {
    global_skin_id: safe.skinId,
    global_effect_id: safe.effectId,
    panel_overrides: safe.panelOverrides,
    self_transfer_names: safe.selfTransferNames,
  };
}

export function resolvePanelAppearance(preferences, panelId) {
  const safe = sanitizeAppearance(preferences);
  const override = safe.panelOverrides[panelId];
  if (override) return { ...override, inherited: false };
  return { skinId: safe.skinId, effectId: safe.effectId, inherited: true };
}

export function withGlobalAppearance(preferences, pair) {
  const safe = sanitizeAppearance(preferences);
  const next = readPair(pair, null);
  return next ? { ...safe, ...next } : safe;
}

export function withPanelOverride(preferences, panelId, pair) {
  const safe = sanitizeAppearance(preferences);
  if (!PANEL_ID_SET.has(panelId)) return safe;
  const next = readPair(pair, null);
  if (!next) return safe;
  return { ...safe, panelOverrides: { ...safe.panelOverrides, [panelId]: next } };
}

export function withoutPanelOverride(preferences, panelId) {
  const safe = sanitizeAppearance(preferences);
  if (!safe.panelOverrides[panelId]) return safe;
  const panelOverrides = { ...safe.panelOverrides };
  delete panelOverrides[panelId];
  return { ...safe, panelOverrides };
}

export function resetAppearance() {
  return copyDefault();
}

export const APPEARANCE_STATIC_EFFECTS = STATIC_EFFECTS;
export const APPEARANCE_MOTION_EFFECTS = MOTION_EFFECTS;
