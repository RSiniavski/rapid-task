/* ============================================================
   Rapid Task — Theme Engine (фаза 1: пресети + застосування + валідація)

   Тема = JSON за схемою з ТЗ (colors / shadows / typography). Рушій:
     • перекладає ключі теми у CSS-змінні на :root (миттєво, без перезавантаження);
     • рахує похідні змінні (--accent-rgb, --on-accent …) — на них тримаються напівпрозорі кольори;
     • валідує тему СУВОРО (значення потрапляють у CSS — інакше можлива CSS-ін'єкція);
     • зберігає вибір користувача (поки що в localStorage "rt_theme").

   Підключати у <head> ПІСЛЯ theme.css — тема застосовується синхронно, до першого малювання.
   ============================================================ */

const ThemeEngine = (() => {
  const STORAGE_KEY = "rt_theme";
  const DEFAULT_KEY = "rapid_task_dark_pastel";

  // ключ теми -> CSS-змінна
  const COLOR_VARS = {
    background: "--bg-0", bg_1: "--bg-1", bg_2: "--bg-2", bg_3: "--bg-3",
    text_primary: "--text-1", text_secondary: "--text-2", text_muted: "--text-3",
    accent: "--accent", accent_soft: "--accent-soft",
    accent_secondary: "--accent-2", accent_secondary_soft: "--accent-2-soft",
    danger: "--danger", warning: "--warning",
    type_idea: "--type-idea", type_epic: "--type-epic", type_task: "--type-task",
    type_subtask: "--type-subtask", type_bug: "--type-bug", type_incident: "--type-incident",
    border: "--border", border_strong: "--border-strong",
  };
  const SHADOW_VARS = { card: "--shadow-1", dropdown: "--shadow-2" };

  // ---------------------------------------------------------- пресети
  function preset(key, name, c, extra = {}) {
    return {
      id: key, key, name, is_preset: true, colors: c,
      shadows: extra.shadows || {
        card: "0 2px 10px rgba(0, 0, 0, 0.25)", dropdown: "0 8px 30px rgba(0, 0, 0, 0.35)",
      },
      typography: {
        font_family: "\"Segoe UI\", \"Inter\", system-ui, -apple-system, sans-serif", base_size: "14.5px",
      },
      created_by: null,
    };
  }
  const LIGHT_SHADOWS = {
    card: "0 2px 10px rgba(40, 40, 70, 0.10)", dropdown: "0 8px 30px rgba(40, 40, 70, 0.18)",
  };

  const PRESETS = [
    preset("rapid_task_dark_pastel", "Rapid Task Dark Pastel (Default)", {
      background: "#12141c", bg_1: "#181b25", bg_2: "#1f2330", bg_3: "#262b3a",
      text_primary: "#e9ebf4", text_secondary: "#a9afc3", text_muted: "#6f7590",
      accent: "#a78bfa", accent_soft: "rgba(167, 139, 250, 0.14)",
      accent_secondary: "#5eead4", accent_secondary_soft: "rgba(94, 234, 212, 0.12)",
      danger: "#fca5a5", warning: "#fdba74",
      type_idea: "#f9a8d4", type_epic: "#c4b5fd", type_task: "#93c5fd",
      type_subtask: "#7dd3fc", type_bug: "#fca5a5", type_incident: "#fdba74",
      border: "rgba(233, 235, 244, 0.08)", border_strong: "rgba(233, 235, 244, 0.14)",
    }),
    preset("rapid_task_light_pastel", "Rapid Task Light Pastel", {
      background: "#f6f4fb", bg_1: "#ffffff", bg_2: "#f0edf8", bg_3: "#e6e1f2",
      text_primary: "#2a2740", text_secondary: "#5b5877", text_muted: "#7d7a96",
      accent: "#7c5cdb", accent_soft: "rgba(124, 92, 219, 0.14)",
      accent_secondary: "#0d9488", accent_secondary_soft: "rgba(13, 148, 136, 0.12)",
      danger: "#d64545", warning: "#c2640a",
      type_idea: "#d6277e", type_epic: "#7c5cdb", type_task: "#2563eb",
      type_subtask: "#0284c7", type_bug: "#d64545", type_incident: "#c2640a",
      border: "rgba(42, 39, 64, 0.10)", border_strong: "rgba(42, 39, 64, 0.18)",
    }, { shadows: LIGHT_SHADOWS }),
    preset("solarized_dark", "Solarized Dark", {
      background: "#002b36", bg_1: "#073642", bg_2: "#0c3f4c", bg_3: "#134b5a",
      text_primary: "#eee8d5", text_secondary: "#93a1a1", text_muted: "#657b83",
      accent: "#268bd2", accent_soft: "rgba(38, 139, 210, 0.18)",
      accent_secondary: "#2aa198", accent_secondary_soft: "rgba(42, 161, 152, 0.16)",
      danger: "#e0605d", warning: "#cb4b16",
      type_idea: "#d33682", type_epic: "#6c71c4", type_task: "#268bd2",
      type_subtask: "#2aa198", type_bug: "#dc322f", type_incident: "#cb4b16",
      border: "rgba(147, 161, 161, 0.14)", border_strong: "rgba(147, 161, 161, 0.26)",
    }),
    preset("solarized_light", "Solarized Light", {
      background: "#fdf6e3", bg_1: "#fffbee", bg_2: "#eee8d5", bg_3: "#e4ddc6",
      text_primary: "#073642", text_secondary: "#586e75", text_muted: "#7f9399",
      accent: "#268bd2", accent_soft: "rgba(38, 139, 210, 0.14)",
      accent_secondary: "#2aa198", accent_secondary_soft: "rgba(42, 161, 152, 0.14)",
      danger: "#dc322f", warning: "#b5530f",
      type_idea: "#d33682", type_epic: "#6c71c4", type_task: "#268bd2",
      type_subtask: "#2aa198", type_bug: "#dc322f", type_incident: "#b5530f",
      border: "rgba(7, 54, 66, 0.12)", border_strong: "rgba(7, 54, 66, 0.22)",
    }, { shadows: LIGHT_SHADOWS }),
    preset("one_dark", "One Dark", {
      background: "#21252b", bg_1: "#282c34", bg_2: "#2c313a", bg_3: "#353b45",
      text_primary: "#d7dae0", text_secondary: "#abb2bf", text_muted: "#7f8798",
      accent: "#61afef", accent_soft: "rgba(97, 175, 239, 0.16)",
      accent_secondary: "#98c379", accent_secondary_soft: "rgba(152, 195, 121, 0.14)",
      danger: "#e06c75", warning: "#d19a66",
      type_idea: "#e5c07b", type_epic: "#c678dd", type_task: "#61afef",
      type_subtask: "#56b6c2", type_bug: "#e06c75", type_incident: "#d19a66",
      border: "rgba(171, 178, 191, 0.10)", border_strong: "rgba(171, 178, 191, 0.18)",
    }),
    preset("nord", "Nord", {
      background: "#2e3440", bg_1: "#3b4252", bg_2: "#434c5e", bg_3: "#4c566a",
      text_primary: "#eceff4", text_secondary: "#d8dee9", text_muted: "#99a4b8",
      accent: "#88c0d0", accent_soft: "rgba(136, 192, 208, 0.16)",
      accent_secondary: "#a3be8c", accent_secondary_soft: "rgba(163, 190, 140, 0.15)",
      danger: "#d9737c", warning: "#ebcb8b",
      type_idea: "#b48ead", type_epic: "#81a1c1", type_task: "#88c0d0",
      type_subtask: "#8fbcbb", type_bug: "#d9737c", type_incident: "#d08770",
      border: "rgba(216, 222, 233, 0.10)", border_strong: "rgba(216, 222, 233, 0.18)",
    }),
  ];

  // ---------------------------------------------------------- кольори
  const HEX_RE = /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/;
  const RGB_RE = /^rgba?\(\s*(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*(\d{1,3})\s*(?:,\s*(\d*\.?\d+)\s*)?\)$/;

  /** -> [r,g,b,a] або null, якщо рядок не є безпечним hex/rgb/rgba кольором */
  function parseColor(value) {
    if (typeof value !== "string") return null;
    const v = value.trim();
    if (HEX_RE.test(v)) {
      let h = v.slice(1);
      if (h.length === 3) h = h.split("").map((c) => c + c).join("");
      const a = h.length === 8 ? parseInt(h.slice(6, 8), 16) / 255 : 1;
      return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16), a];
    }
    const m = RGB_RE.exec(v);
    if (!m) return null;
    const rgb = [Number(m[1]), Number(m[2]), Number(m[3])];
    const a = m[4] === undefined ? 1 : Number(m[4]);
    if (rgb.some((n) => n > 255) || a < 0 || a > 1) return null;
    return [...rgb, a];
  }

  function luminance([r, g, b]) {
    const f = (c) => { c /= 255; return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; };
    return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
  }

  // ---------------------------------------------------------- валідація (для імпорту — фаза 4)
  const SHADOW_RE = /^[0-9a-zA-Z\s.,()#%-]{1,200}$/;
  const FONT_RE = /^[A-Za-z0-9 ,'"\-]{1,200}$/;
  const SIZE_RE = /^\d{1,2}(?:\.\d{1,2})?px$/;

  /** -> { ok, errors: [рядки з точним шляхом до проблемного поля] } */
  function validate(theme) {
    const errors = [];
    if (!theme || typeof theme !== "object" || Array.isArray(theme)) {
      return { ok: false, errors: ["theme: must be a JSON object"] };
    }
    if (typeof theme.name !== "string" || !theme.name.trim() || theme.name.length > 80) {
      errors.push("name: required, 1-80 characters");
    }
    const colors = theme.colors;
    if (!colors || typeof colors !== "object" || Array.isArray(colors)) {
      errors.push("colors: required object");
    } else {
      for (const key of Object.keys(COLOR_VARS)) {
        if (!(key in colors)) errors.push(`colors.${key}: missing required key`);
        else if (!parseColor(colors[key])) errors.push(`colors.${key}: invalid color "${String(colors[key]).slice(0, 40)}"`);
      }
      for (const key of Object.keys(colors)) {
        if (!(key in COLOR_VARS)) errors.push(`colors.${key}: unknown key`);
      }
    }
    const shadows = theme.shadows;
    if (!shadows || typeof shadows !== "object") errors.push("shadows: required object");
    else {
      for (const key of Object.keys(SHADOW_VARS)) {
        const v = shadows[key];
        if (typeof v !== "string" || !SHADOW_RE.test(v) || /url\s*\(/i.test(v)) errors.push(`shadows.${key}: invalid value`);
      }
    }
    const typo = theme.typography;
    if (!typo || typeof typo !== "object") errors.push("typography: required object");
    else {
      if (typeof typo.font_family !== "string" || !FONT_RE.test(typo.font_family)) errors.push("typography.font_family: invalid value");
      if (typeof typo.base_size !== "string" || !SIZE_RE.test(typo.base_size)) errors.push("typography.base_size: expected e.g. \"14.5px\"");
    }
    return { ok: errors.length === 0, errors };
  }

  // ---------------------------------------------------------- застосування
  const TRIPLET_VARS = {
    "--accent-rgb": "accent", "--accent-2-rgb": "accent_secondary", "--danger-rgb": "danger",
    "--warning-rgb": "warning", "--type-task-rgb": "type_task", "--text-rgb": "text_primary",
    "--bg-rgb": "background", "--bg-1-rgb": "bg_1",
  };

  function apply(theme) {
    const check = validate(theme);
    if (!check.ok) { console.warn("[theme] invalid theme not applied:", check.errors); return false; }
    const root = document.documentElement;
    for (const [key, cssVar] of Object.entries(COLOR_VARS)) root.style.setProperty(cssVar, theme.colors[key].trim());
    for (const [key, cssVar] of Object.entries(SHADOW_VARS)) root.style.setProperty(cssVar, theme.shadows[key].trim());
    root.style.setProperty("--font", theme.typography.font_family.trim());
    root.style.setProperty("--base-size", theme.typography.base_size);
    for (const [cssVar, key] of Object.entries(TRIPLET_VARS)) {
      const [r, g, b] = parseColor(theme.colors[key]);
      root.style.setProperty(cssVar, `${r} ${g} ${b}`);
    }
    // читабельний колір тексту на акцентних кнопках
    const accent = parseColor(theme.colors.accent);
    root.style.setProperty("--on-accent", luminance(accent) > 0.4 ? "#16131f" : "#ffffff");
    // light/dark для нативних елементів (скролбари, поля вводу)
    const dark = luminance(parseColor(theme.colors.background)) < 0.4;
    root.style.colorScheme = dark ? "dark" : "light";
    root.dataset.theme = theme.key || theme.id || "custom";
    return true;
  }

  // ---------------------------------------------------------- вибір користувача
  function list() { return PRESETS.slice(); }
  function find(key) { return PRESETS.find((t) => t.key === key) || null; }

  function savedKey() {
    try { return localStorage.getItem(STORAGE_KEY) || DEFAULT_KEY; } catch (_) { return DEFAULT_KEY; }
  }

  function select(key) {
    const theme = find(key) || find(DEFAULT_KEY);
    apply(theme);
    try { localStorage.setItem(STORAGE_KEY, theme.key); } catch (_) { /* приватний режим */ }
    return theme;
  }

  function current() { return document.documentElement.dataset.theme || DEFAULT_KEY; }

    /** Called after we know the user: apply the theme saved on the server. */
    /** Called after we know the user: pick the right theme (project lock > personal > project). */
  async function syncFromUser(user) {
    if (!user || typeof API === "undefined") return;
    try {
      const projectId = parseInt(new URLSearchParams(location.search).get("project"), 10);
      let settings = null;
      if (projectId > 0) {
        try { settings = await API.projectThemeSettings(projectId); } catch (_) { settings = null; }
      }
      let personal = null;
      if (user.theme_id != null) {
        const all = await API.themes();
        personal = all.find((t) => t.id === user.theme_id) || null;
      }
      const projectTheme = settings && settings.theme ? settings.theme : null;
      const locked = !!(settings && settings.is_locked && projectTheme);

      const chosen = locked ? projectTheme : (personal || projectTheme);
      if (chosen && apply(chosen) && chosen === personal) {
        try { localStorage.setItem(STORAGE_KEY, chosen.key || DEFAULT_KEY); } catch (_) {}
      }
    } catch (_) { /* keep the local theme if the server is not reachable */ }
  }

  function init() { apply(find(savedKey()) || find(DEFAULT_KEY)); }

  // синхронізація між вкладками
  window.addEventListener("storage", (e) => { if (e.key === STORAGE_KEY) init(); });

  init();
  return { list, find, select, current, apply, validate, parseColor, syncFromUser, DEFAULT_KEY };
})();