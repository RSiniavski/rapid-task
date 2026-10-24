"""Сувора валідація імпортованої теми. Значення потрапляють у CSS, тому приймаємо
лише дозволені формати (hex / rgb / rgba, обмежені тіні, шрифти зі списку) — це захист від CSS-ін'єкцій."""
import re

MAX_JSON_BYTES = 20_000

COLOR_KEYS = [
    "background", "bg_1", "bg_2", "bg_3",
    "text_primary", "text_secondary", "text_muted",
    "accent", "accent_soft", "accent_secondary", "accent_secondary_soft",
    "danger", "warning",
    "type_idea", "type_epic", "type_task", "type_subtask", "type_bug", "type_incident",
    "border", "border_strong",
]
SHADOW_KEYS = ["card", "dropdown"]

HEX_RE = re.compile(r"^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$")
RGB_RE = re.compile(r"^rgba?\(\s*(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*(\d{1,3})\s*(?:,\s*(\d*\.?\d+)\s*)?\)$")
SHADOW_RE = re.compile(r"^[0-9a-zA-Z\s.,()#%-]{1,200}$")
SIZE_RE = re.compile(r"^\d{1,2}(?:\.\d{1,2})?px$")

# шрифти — лише з білого списку (довільний font-family = вектор ін'єкції)
FONT_WHITELIST = {
    "Segoe UI", "Inter", "Roboto", "Arial", "Helvetica", "Verdana", "Tahoma", "Georgia",
    "Times New Roman", "Courier New", "Consolas", "Fira Code", "JetBrains Mono",
    "system-ui", "-apple-system", "sans-serif", "serif", "monospace",
}


def _color_ok(value) -> bool:
    if not isinstance(value, str):
        return False
    v = value.strip()
    if HEX_RE.match(v):
        return True
    m = RGB_RE.match(v)
    if not m:
        return False
    if any(int(m.group(i)) > 255 for i in (1, 2, 3)):
        return False
    return m.group(4) is None or 0 <= float(m.group(4)) <= 1


def _font_ok(value) -> bool:
    if not isinstance(value, str) or len(value) > 200:
        return False
    parts = [p.strip().strip('"').strip("'") for p in value.split(",")]
    return 0 < len(parts) <= 8 and all(p in FONT_WHITELIST for p in parts)


def validate_theme(theme) -> list:
    """Повертає список помилок (порожній = тема коректна)."""
    errors = []
    if not isinstance(theme, dict):
        return ["theme: must be a JSON object"]
    name = theme.get("name")
    if not isinstance(name, str) or not (1 <= len(name.strip()) <= 80):
        errors.append("name: required, 1-80 characters")
    elif re.search(r"[<>]", name):
        errors.append("name: characters < and > are not allowed")

    colors = theme.get("colors")
    if not isinstance(colors, dict):
        errors.append("colors: required object")
    else:
        for key in COLOR_KEYS:
            if key not in colors:
                errors.append(f"colors.{key}: missing required key")
            elif not _color_ok(colors[key]):
                errors.append(f"colors.{key}: invalid color")
        for key in colors:
            if key not in COLOR_KEYS:
                errors.append(f"colors.{key}: unknown key")

    shadows = theme.get("shadows")
    if not isinstance(shadows, dict):
        errors.append("shadows: required object")
    else:
        for key in SHADOW_KEYS:
            v = shadows.get(key)
            if not isinstance(v, str) or not SHADOW_RE.match(v) or "url" in v.lower():
                errors.append(f"shadows.{key}: invalid value")
        for key in shadows:
            if key not in SHADOW_KEYS:
                errors.append(f"shadows.{key}: unknown key")

    typo = theme.get("typography")
    if not isinstance(typo, dict):
        errors.append("typography: required object")
    else:
        if not _font_ok(typo.get("font_family")):
            errors.append("typography.font_family: font is not in the allowed list")
        size = typo.get("base_size")
        if not isinstance(size, str) or not SIZE_RE.match(size):
            errors.append('typography.base_size: expected a value like "14.5px"')
        else:
            px = float(size[:-2])
            if not 10 <= px <= 24:
                errors.append("typography.base_size: must be between 10px and 24px")
        for key in typo:
            if key not in ("font_family", "base_size"):
                errors.append(f"typography.{key}: unknown key")

    for key in theme:
        if key not in ("name", "colors", "shadows", "typography"):
            errors.append(f"{key}: unknown key")
    return errors