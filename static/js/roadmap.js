/* ============================================================
   Rapid Task — Nested Dependency Roadmap
   Інтерактивна ієрархічна дошка залежностей: нескінченне полотно
   із semantic zoom, віхами (macro-blocks), тікетами всередині,
   стрілками залежностей (FS/SS/FF/SF) та drag & drop тікетів між віхами.

   Сторінка написана на чистому JS (без Vue): полотно з transform,
   SVG-конекторами та pointer-жестами простіше і швидше керувати напряму.
   Геометрія та масштаб — у roadmap-core.js.
   ============================================================ */
(function () {
  "use strict";

  const Core = window.RoadmapCore;
  let ticketHost = null;      // shared ticket dialogs (js/ticket-dialogs.js)
  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s == null ? "" : s).replace(/[&<>"']/g,
    (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

  // i18n з підстановкою {var}
  function t(key, vars) {
    let text = i18nGet(key);
    if (vars) for (const k of Object.keys(vars)) text = text.split(`{${k}}`).join(vars[k]);
    return text;
  }

  const STATUS_KEYS = ["planned", "in_progress", "done"];
  const DEP_TYPES = ["FS", "SS", "FF", "SF"];

  const state = {
    projectId: null,
    me: null,
    project: null,
    role: null,
    canPlan: false,
    isAdmin: false,
    milestones: [],           // з API + локальні x, y
    deps: [],
    blockedTicketIds: new Set(),
    tickets: [],
    view: { x: 60, y: 60, s: 1 },
    overrides: new Map(),     // id віхи -> "micro" | "macro" (ручне розкриття/згортання)
    lastMicro: null,          // чи був попередній рендер у мікро-режимі
    pulse: new Set(),         // віхи, у яких щойно змінився прогрес
    filter: "",
    editing: null,            // віха, що редагується у модалці
  };

  const els = {};
  let linkFrame = 0;
  let resizeObserver = null;

  // ------------------------------------------------------------
  // Ініціалізація та завантаження
  // ------------------------------------------------------------
  document.addEventListener("DOMContentLoaded", init);

  async function init() {
    if (!API.token()) { location.href = "/"; return; }
    const rawProject = new URLSearchParams(location.search).get("project") || "";
    // strict: digits only (parseInt would read "5abc" as 5)
    state.projectId = /^\d+$/.test(rawProject) ? Number(rawProject) : NaN;

    for (const id of ["viewport", "world", "blocks", "links", "links-layer", "link-draft", "zoom-label",
      "level-label", "legend", "empty", "backlog", "backlog-list", "backlog-count", "backlog-search",
      "popover", "toast", "error", "modal-backdrop", "form", "form-error", "project-name",
      "project-key", "role-badge", "readonly", "add", "auto-layout", "board-link"]) {
      els[id] = $("rm-" + id);
    }

    if (!state.projectId) { showError(t("rm.err.load")); return; }
    els["board-link"].href = `/board.html?project=${state.projectId}`;

    fillStatusOptions();
    applyTitles();
    bindUi();

    try {
      await load();
    } catch (err) {
      if (err.status === 401) { location.href = "/"; return; }
      showError(err.status === 403 ? err.message : `${t("rm.err.load")}: ${err.message}`);
      return;
    }

    restoreView();
    renderAll();
    if (!state.hasSavedView) fit();
        // shared ticket dialogs: create from the toolbar or from a milestone
    ticketHost = mountTicketHost(state.projectId);
    ticketHost.onChange(async () => {
      try {
        state.tickets = await API.projectTickets(state.projectId);
        await reloadRoadmap({ pulse: true });
        renderAll();
      } catch (err) { toast(humanError(err), true); }
    });
    $("rm-new-ticket").addEventListener("click", () => ticketHost.openCreate({}));
  }

  async function load() {
    const [me, project, stats, tickets, roadmap] = await Promise.all([
      API.me(),
      API.project(state.projectId),
      API.projectStats(state.projectId),
      API.projectTickets(state.projectId),
      API.roadmap(state.projectId),
    ]);
    state.me = me;
    state.project = project;
    state.role = stats.role;
    state.canPlan = stats.role === "admin" || stats.role === "editor";
    state.isAdmin = stats.role === "admin";
    state.tickets = tickets;
    applyRoadmap(roadmap);

    els["project-name"].textContent = project.name;
    els["project-key"].textContent = project.key;
    els["project-key"].hidden = false;
    els["role-badge"].hidden = false;
    els["role-badge"].className = "badge role-" + stats.role;
    els["role-badge"].textContent = t("role." + stats.role);
    els["add"].hidden = !state.canPlan;
    els["auto-layout"].hidden = !state.canPlan;
    els["readonly"].hidden = state.canPlan;
    document.body.classList.toggle("can-plan", state.canPlan);
  }

  // Розкладаємо відповідь API у стан; віхам без збереженої позиції дає авто-розкладку
  function applyRoadmap(roadmap) {
    const layout = Core.autoLayout(roadmap.milestones,
      roadmap.dependencies.filter((d) => d.entity === "milestone"));
    state.milestones = roadmap.milestones.map((m) => ({
      ...m,
      x: m.pos_x != null ? m.pos_x : layout[m.id].x,
      y: m.pos_y != null ? m.pos_y : layout[m.id].y,
    }));
    state.deps = roadmap.dependencies;
    state.blockedTicketIds = new Set(roadmap.blocked_ticket_ids);
  }

  async function reloadRoadmap({ pulse = false } = {}) {
    const before = new Map(state.milestones.map((m) => [m.id, `${m.progress}|${m.status}|${m.tickets_total}`]));
    const roadmap = await API.roadmap(state.projectId);
    // позиції, які користувач щойно змінив, мають пріоритет над збереженими
    const local = new Map(state.milestones.map((m) => [m.id, m]));
    applyRoadmap(roadmap);
    for (const m of state.milestones) {
      const old = local.get(m.id);
      if (old && m.pos_x == null) { m.x = old.x; m.y = old.y; }
    }
    if (pulse) {
      state.pulse = new Set(state.milestones
        .filter((m) => before.has(m.id) && before.get(m.id) !== `${m.progress}|${m.status}|${m.tickets_total}`)
        .map((m) => m.id));
      setTimeout(() => {
        state.pulse.clear();
        document.querySelectorAll(".rm-pulse").forEach((el) => el.classList.remove("rm-pulse"));
      }, 1500);
    }
  }

  // ------------------------------------------------------------
  // Допоміжні дані
  // ------------------------------------------------------------
  const ticketsOf = (milestoneId) => state.tickets
    .filter((tk) => tk.milestone_id === milestoneId)
    .sort((a, b) => ((a.column ? a.column.position : 0) - (b.column ? b.column.position : 0)) || (a.id - b.id));

  const milestoneById = (id) => state.milestones.find((m) => m.id === id);
  const ticketById = (id) => state.tickets.find((tk) => tk.id === id);

  function isMicro(m) {
    if (state.overrides.has(m.id)) return state.overrides.get(m.id) === "micro";
    return state.view.s >= Core.MICRO_AT;
  }

  function fmtDate(iso) {
    if (!iso) return "";
    const d = new Date(iso + "T00:00:00");
    const lang = localStorage.getItem("rt_lang") || "uk";
    return d.toLocaleDateString(lang === "uk" ? "uk-UA" : "en-GB", { day: "2-digit", month: "short" });
  }

  function fillStatusOptions() {
    const select = $("rm-f-status");
    [...select.options].forEach((o) => { o.textContent = t("rm.status." + o.value); });
  }

  function applyTitles() {
    document.querySelectorAll("[data-i18n-title]").forEach((el) => { el.title = t(el.dataset.i18nTitle); });
  }

  // ------------------------------------------------------------
  // Рендер
  // ------------------------------------------------------------
  function renderAll() {
    renderBlocks();
    renderBacklog();
    applyView();
    renderLinks();
  }

  function renderBlocks() {
    state.lastMicro = state.view.s >= Core.MICRO_AT;
    els["blocks"].innerHTML = state.milestones.map(blockHtml).join("");
    els["empty"].hidden = state.milestones.length > 0;

    // блоки можуть змінити висоту (шрифти, тікети) — тримаємо стрілки в актуальному стані
    if (resizeObserver) resizeObserver.disconnect();
    else if (window.ResizeObserver) resizeObserver = new ResizeObserver(() => scheduleLinks());
    if (resizeObserver) els["blocks"].querySelectorAll(".rm-block").forEach((b) => resizeObserver.observe(b));
  }

  function blockHtml(m) {
    const micro = isMicro(m);
    const cls = ["rm-block", "rm-st-" + m.status, "rm-risk-" + m.risk_level,
      micro ? "is-micro" : "is-macro"];
    if (m.is_bottleneck) cls.push("is-bottleneck");
    if (m.is_blocked) cls.push("is-blocked");
    if (state.pulse.has(m.id)) cls.push("rm-pulse");

    const badges = [`<span class="badge rm-badge-status rm-badge-${m.status}">${esc(t("rm.status." + m.status))}</span>`];
    if (m.risk_level !== "none") {
      const reasons = m.risk_reasons.map((r) => "• " + t("rm.reason." + r)).join("\n");
      badges.push(`<span class="badge rm-badge-risk rm-badge-${m.risk_level}" title="${esc(reasons)}">` +
        `${m.risk_level === "danger" ? "⛔" : "⚠"} ${esc(t("rm.badge.risk_" + m.risk_level))}</span>`);
    }
    if (m.is_bottleneck) {
      badges.push(`<span class="badge rm-badge-hot" title="${esc(t("rm.downstream") + ": " + m.downstream_count)}">` +
        `🔥 ${esc(t("rm.badge.bottleneck"))}</span>`);
    }
    if (m.is_blocked) {
      const names = m.blocked_by.map((id) => (milestoneById(id) || {}).title || "#" + id).join(", ");
      badges.push(`<span class="badge rm-badge-blocked" title="${esc(t("rm.blocked_by") + ": " + names)}">` +
        `🔒 ${esc(t("rm.badge.blocked"))}</span>`);
    }
    if (m.ready_to_close) {
      badges.push(`<span class="badge rm-badge-ready">🏁 ${esc(t("rm.badge.ready"))}</span>`);
    }

    const dates = (m.start_date || m.due_date)
      ? `<div class="rm-block-dates">📅 ${esc(fmtDate(m.start_date) || "…")} → ${esc(fmtDate(m.due_date) || "…")}</div>` : "";

    const progressLabel = m.tickets_total > 0
      ? `${m.tickets_done}/${m.tickets_total} ${esc(t("rm.progress"))} · ${m.progress}%`
      : `${m.progress}% · ${esc(t("rm.no_tickets"))}`;

    let body = "";
    if (micro) {
      const list = ticketsOf(m.id);
      body = `<div class="rm-block-tickets">` +
        (list.length ? list.map(chipHtml).join("")
          : `<div class="rm-drop-hint">${esc(t("rm.drop_here"))}</div>`) + `</div>`;
    }

    const desc = m.description ? `<div class="rm-block-desc">${esc(m.description)}</div>` : "";

    return `<div class="${cls.join(" ")}" data-block="${m.id}" style="left:${m.x}px;top:${m.y}px"` +
      ` data-link-kind="milestone" data-link-id="${m.id}">` +
      `<div class="rm-block-head">` +
        `<span class="rm-block-title" title="${esc(m.title)}">${esc(m.title)}</span>` +
        `<span class="rm-block-actions">` +
          `<button type="button" class="icon-btn rm-act" data-act="toggle" title="${esc(t(micro ? "rm.collapse" : "rm.expand"))}">${micro ? "▾" : "▸"}</button>` +
          (state.canPlan ? `<button type="button" class="icon-btn rm-act" data-act="edit" title="${esc(t("rm.edit"))}">✎</button>` : "") +
          (state.isAdmin && m.is_closed ? `<button type="button" class="icon-btn rm-act" data-act="reopen" title="${esc(t("rm.reopen"))}">↺</button>` : "") +
          (state.isAdmin && !m.is_closed && (m.ready_to_close || m.tickets_total === 0) ? `<button type="button" class="icon-btn rm-act" data-act="close" title="${esc(t("rm.close"))}">✔</button>` : "") +
          (!m.is_closed ? `<button type="button" class="icon-btn rm-act" data-act="newticket" title="${esc(t("rm.new_ticket_in"))}">＋</button>` : "") +
        `</span>` +
      `</div>` +
      `<div class="rm-badges">${badges.join("")}</div>` +
      dates + desc +
      `<div class="rm-progress"><div class="rm-progress-fill" style="width:${m.progress}%"></div></div>` +
      `<div class="rm-progress-label">${progressLabel}</div>` +
      body +
      (state.canPlan ? `<span class="rm-handle" data-handle title="${esc(t("rm.link_hint"))}"></span>` : "") +
      `</div>`;
  }

  function chipHtml(tk) {
    const meta = typeMeta(tk.type);
    const cls = ["rm-chip"];
    if (tk.column && tk.column.is_done) cls.push("is-done");
    const blocked = state.blockedTicketIds.has(tk.id);
    if (blocked) cls.push("is-blocked");
    const colName = tk.column ? tk.column.name : "";
    return `<div class="${cls.join(" ")}" data-ticket-id="${tk.id}" data-link-kind="ticket" data-link-id="${tk.id}"` +
      ` style="--chip: var(${meta.colorVar})" title="${esc(tk.key + " · " + tk.title + (colName ? " · " + colName : ""))}">` +
      `<span class="rm-chip-icon">${meta.icon}</span>` +
      `<span class="rm-chip-key">${esc(tk.key)}</span>` +
      `<span class="rm-chip-title">${esc(tk.title)}</span>` +
      (colName ? `<span class="rm-chip-col">${esc(colName)}</span>` : "") +
      (blocked ? `<span class="rm-chip-lock" title="${esc(t("rm.badge.blocked"))}">🔒</span>` : "") +
      (state.canPlan ? `<span class="rm-handle rm-handle-chip" data-handle></span>` : "") +
      `</div>`;
  }

  function renderBacklog() {
    const q = state.filter.trim().toLowerCase();
    const list = state.tickets
      .filter((tk) => !tk.milestone_id)
      .filter((tk) => !q || tk.key.toLowerCase().includes(q) || tk.title.toLowerCase().includes(q))
      .sort((a, b) => b.id - a.id);
    const unassigned = state.tickets.filter((tk) => !tk.milestone_id).length;
    els["backlog-count"].textContent = unassigned;
    els["backlog-list"].innerHTML = list.length
      ? list.map((tk) => {
          const meta = typeMeta(tk.type);
          return `<div class="rm-chip rm-chip-backlog${tk.column && tk.column.is_done ? " is-done" : ""}"` +
            ` data-ticket-id="${tk.id}" style="--chip: var(${meta.colorVar})" title="${esc(tk.key + " · " + tk.title)}">` +
            `<span class="rm-chip-icon">${meta.icon}</span><span class="rm-chip-key">${esc(tk.key)}</span>` +
            `<span class="rm-chip-title">${esc(tk.title)}</span>` +
            (tk.column ? `<span class="rm-chip-col">${esc(tk.column.name)}</span>` : "") + `</div>`;
        }).join("")
      : `<div class="muted rm-backlog-empty">${esc(t("rm.backlog.empty"))}</div>`;
  }

  // ------------------------------------------------------------
  // Вид: переміщення / масштаб / semantic zoom
  // ------------------------------------------------------------
  function applyView() {
    const { x, y, s } = state.view;
    els["world"].style.transform = `translate(${x}px, ${y}px) scale(${s})`;
    const vp = els["viewport"];
    vp.style.backgroundSize = `${24 * s}px ${24 * s}px`;
    vp.style.backgroundPosition = `${x}px ${y}px`;
    const level = Core.levelFor(s);
    vp.classList.remove("lvl-far", "lvl-macro", "lvl-micro");
    vp.classList.add("lvl-" + level);
    els["zoom-label"].textContent = Math.round(s * 100) + "%";
    els["level-label"].textContent = t("rm.level." + level);
    saveViewSoon();
  }

  // Зміна масштабу: при перетині порогу мікро/макро — перебудовуємо блоки
  function setView(next) {
    state.view = next;
    const micro = next.s >= Core.MICRO_AT;
    if (micro !== state.lastMicro) {
      state.overrides.clear();
      renderBlocks();
      scheduleLinks();
    }
    applyView();
  }

  function zoomBy(factor, cx, cy) {
    const rect = els["viewport"].getBoundingClientRect();
    if (cx == null) { cx = rect.width / 2; cy = rect.height / 2; }
    setView(Core.zoomAt(state.view, factor, cx, cy));
  }

  function fit() {
    const rects = [...els["blocks"].querySelectorAll(".rm-block")].map(worldRect);
    const box = Core.bboxOf(rects);
    const rect = els["viewport"].getBoundingClientRect();
    setView(box ? Core.fitView(box, rect.width, rect.height, 60, 1) : { x: 60, y: 60, s: 1 });
  }

  // позиція/розмір елемента в координатах світу (враховує transform і прокрутку списків)
  function worldRect(el) {
    const w = els["world"].getBoundingClientRect();
    const r = el.getBoundingClientRect();
    const s = state.view.s;
    return { x: (r.left - w.left) / s, y: (r.top - w.top) / s, w: r.width / s, h: r.height / s };
  }

  function clientToWorld(cx, cy) {
    const w = els["world"].getBoundingClientRect();
    return { x: (cx - w.left) / state.view.s, y: (cy - w.top) / state.view.s };
  }

  const viewKey = () => `rt_rm_view_${state.projectId}`;
  let saveTimer = 0;
  function saveViewSoon() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      try { localStorage.setItem(viewKey(), JSON.stringify(state.view)); } catch (_) { /* приватний режим */ }
    }, 250);
  }
  function restoreView() {
    state.hasSavedView = false;
    try {
      const raw = JSON.parse(localStorage.getItem(viewKey()) || "null");
      if (raw && isFinite(raw.x) && isFinite(raw.y) && isFinite(raw.s)) {
        state.view = { x: raw.x, y: raw.y, s: Core.clamp(raw.s, Core.MIN_SCALE, Core.MAX_SCALE) };
        state.hasSavedView = true;
      }
    } catch (_) { /* ігноруємо пошкоджене сховище */ }
  }

  // ------------------------------------------------------------
  // Стрілки залежностей
  // ------------------------------------------------------------
  function scheduleLinks() {
    if (linkFrame) return;
    linkFrame = requestAnimationFrame(() => { linkFrame = 0; renderLinks(); });
  }

  function renderLinks() {
    const blockEls = new Map();
    els["blocks"].querySelectorAll(".rm-block").forEach((b) => blockEls.set(parseInt(b.dataset.block, 10), b));
    const chipEls = new Map();
    els["blocks"].querySelectorAll(".rm-chip[data-ticket-id]").forEach((c) => chipEls.set(parseInt(c.dataset.ticketId, 10), c));

    // прямокутник кінця залежності: чіп (з обрізкою по видимій частині списку) або блок віхи
    function endRect(dep, id) {
      if (dep.entity === "milestone") {
        const el = blockEls.get(id);
        return el ? worldRect(el) : null;
      }
      const chip = chipEls.get(id);
      if (chip) {
        const rect = worldRect(chip);
        const list = chip.closest(".rm-block-tickets");
        if (list) {
          const lr = worldRect(list);
          const top = Math.max(rect.y, lr.y), bottom = Math.min(rect.y + rect.h, lr.y + lr.h);
          if (bottom - top < 4) { rect.y = Math.min(Math.max(rect.y, lr.y), lr.y + lr.h - 4); rect.h = 4; }
          else { rect.y = top; rect.h = bottom - top; }
        }
        return rect;
      }
      const tk = ticketById(id);   // тікет у згорнутому блоці — стрілка до самої віхи
      const block = tk && tk.milestone_id ? blockEls.get(tk.milestone_id) : null;
      return block ? worldRect(block) : null;
    }

    let paths = "";
    for (const dep of state.deps) {
      const a = endRect(dep, dep.predecessor_id);
      const b = endRect(dep, dep.successor_id);
      if (!a || !b) continue;
      if (dep.entity === "ticket" && a.x === b.x && a.y === b.y && a.w === b.w && a.h === b.h) continue;

      const g = Core.edgeGeometry(a, b);
      const bad = dep.state === "violated" || dep.schedule_conflict;
      const kind = bad ? "bad" : dep.state === "waiting" ? "waiting" : "ok";
      const pred = dep.entity === "milestone" ? milestoneById(dep.predecessor_id) : null;
      const hot = pred && pred.is_bottleneck && kind !== "ok";
      const cls = `rm-link rm-link-${kind} rm-link-${dep.entity}${hot ? " is-hot" : ""}`;
      paths += `<path class="${cls}" d="${g.d}" marker-end="url(#rm-arrow-${kind})"/>`;
      paths += `<path class="rm-link-hit" data-dep="${dep.id}" d="${g.d}"/>`;
      if (dep.entity === "milestone") {
        paths += `<g class="rm-link-label rm-label-${kind}" data-dep="${dep.id}" transform="translate(${g.mid.x} ${g.mid.y})">` +
          `<rect x="-17" y="-10" width="34" height="20" rx="10"/><text>${dep.type}</text></g>`;
      }
    }
    els["links-layer"].innerHTML = paths;
  }

  // ------------------------------------------------------------
  // Жести: pan / pinch / drag блоку / drag тікета / створення зв'язку
  // ------------------------------------------------------------
  function bindUi() {
    const vp = els["viewport"];
    const pointers = new Map();     // активні дотики для pinch
    let pinch = null;

    vp.addEventListener("pointerdown", (e) => {
      if (e.pointerType === "mouse" && e.button !== 0 && e.button !== 1) return;
      const target = e.target;
      if (target.closest(".rm-hud")) return;
      hidePopover();
      if (target.closest("button, a, input, select, textarea")) return;

      pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (pointers.size === 2) {                      // другий дотик — pinch-zoom
        const [p1, p2] = [...pointers.values()];
        pinch = { dist: Math.hypot(p1.x - p2.x, p1.y - p2.y), mx: (p1.x + p2.x) / 2, my: (p1.y + p2.y) / 2 };
        return;
      }

      const handle = target.closest("[data-handle]");
      const chip = target.closest(".rm-chip");
      const head = target.closest(".rm-block-head");
      if (handle && state.canPlan) {
        const source = handle.closest(".rm-chip") || handle.closest(".rm-block");
        beginGesture(e, linkGesture(source));
      } else if (chip) {
        beginGesture(e, ticketGesture(chip));
      } else if (head && state.canPlan) {
        beginGesture(e, blockGesture(head.closest(".rm-block")));
      } else if (target.closest(".rm-link-hit, .rm-link-label")) {
        // клік по стрілці обробляє окремий click-слухач
      } else {
        vp.focus({ preventScroll: true });
        beginGesture(e, panGesture(), 3);
      }
    });

    const releasePointer = (e) => { pointers.delete(e.pointerId); if (pointers.size < 2) pinch = null; };
    window.addEventListener("pointerup", releasePointer);
    window.addEventListener("pointercancel", releasePointer);
    window.addEventListener("pointermove", (e) => {
      if (!pointers.has(e.pointerId)) return;
      pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (pinch && pointers.size >= 2) {
        const [p1, p2] = [...pointers.values()];
        const dist = Math.hypot(p1.x - p2.x, p1.y - p2.y);
        const mx = (p1.x + p2.x) / 2, my = (p1.y + p2.y) / 2;
        const rect = vp.getBoundingClientRect();
        const zoomed = Core.zoomAt(state.view, dist / pinch.dist, mx - rect.left, my - rect.top);
        setView({ ...zoomed, x: zoomed.x + (mx - pinch.mx), y: zoomed.y + (my - pinch.my) });
        pinch = { dist, mx, my };
      }
    });

    // колесо — масштаб до курсора; прокрутка списку тікетів всередині блоку лишається рідною
    vp.addEventListener("wheel", (e) => {
      const list = e.target.closest && e.target.closest(".rm-block-tickets");
      if (list && !e.ctrlKey && list.scrollHeight > list.clientHeight) return;
      e.preventDefault();
      const rect = vp.getBoundingClientRect();
      const k = e.ctrlKey ? 0.01 : 0.0015;
      zoomBy(Math.exp(-e.deltaY * k), e.clientX - rect.left, e.clientY - rect.top);
    }, { passive: false });

    vp.addEventListener("keydown", (e) => {
      if (e.target.closest("input, textarea, select")) return;
      if (e.key === "+" || e.key === "=") zoomBy(1.2);
      else if (e.key === "-" || e.key === "_") zoomBy(1 / 1.2);
      else if (e.key === "0") setView({ x: state.view.x, y: state.view.y, s: 1 });
      else if (e.key.toLowerCase() === "f") fit();
    });

    // кнопки на блоках та клік по стрілках
    vp.addEventListener("click", (e) => {
      const act = e.target.closest("[data-act]");
      if (act) {
        const block = act.closest(".rm-block");
        const m = milestoneById(parseInt(block.dataset.block, 10));
        if (!m) return;
        if (act.dataset.act === "edit") openModal(m);
        else if (act.dataset.act === "close" || act.dataset.act === "reopen") toggleClosed(m, act.dataset.act);
        else if (act.dataset.act === "newticket") ticketHost.openCreate({ milestone_id: m.id });
        else {
          state.overrides.set(m.id, isMicro(m) ? "macro" : "micro");
          renderBlocks();
          renderLinks();
        }
        return;
      }
      const dep = e.target.closest("[data-dep]");
      if (dep) showPopover(parseInt(dep.dataset.dep, 10), e.clientX, e.clientY);
    });
    vp.addEventListener("dblclick", (e) => {   // подвійний клік по порожньому — вписати все
      if (!e.target.closest(".rm-block, .rm-link-hit, .rm-link-label, .rm-hud")) fit();
    });

    // беклог: перетягування тікетів на віхи
    els["backlog-list"].addEventListener("pointerdown", (e) => {
      if (e.pointerType === "mouse" && e.button !== 0) return;
      const chip = e.target.closest(".rm-chip");
      if (chip) beginGesture(e, ticketGesture(chip), 4);
    });
    els["backlog-search"].addEventListener("input", (e) => { state.filter = e.target.value; renderBacklog(); });

    // HUD і панель інструментів
    $("rm-zoom-in").addEventListener("click", () => zoomBy(1.25));
    $("rm-zoom-out").addEventListener("click", () => zoomBy(1 / 1.25));
    $("rm-zoom-fit").addEventListener("click", fit);
    $("rm-zoom-reset").addEventListener("click", () => setView({ x: state.view.x, y: state.view.y, s: 1 }));
    $("rm-toggle-backlog").addEventListener("click", () => { els["backlog"].hidden = !els["backlog"].hidden; });
    $("rm-toggle-legend").addEventListener("click", () => { els["legend"].hidden = !els["legend"].hidden; });
    els["add"].addEventListener("click", () => openModal(null));
    els["auto-layout"].addEventListener("click", autoLayoutAll);

    // модалка
    $("rm-modal-close").addEventListener("click", closeModal);
    $("rm-f-cancel").addEventListener("click", closeModal);
    els["modal-backdrop"].addEventListener("click", (e) => { if (e.target === els["modal-backdrop"]) closeModal(); });
    els["form"].addEventListener("submit", submitModal);
    $("rm-f-delete").addEventListener("click", deleteEditing);
    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape") { closeModal(); hidePopover(); }
    });
    document.addEventListener("pointerdown", (e) => {
      if (!els["popover"].hidden && !e.target.closest("#rm-popover, .rm-link-hit, .rm-link-label")) hidePopover();
    });

    // перемикач мови: перемальовуємо динамічний вміст
    document.querySelectorAll(".lang-switch button").forEach((btn) => {
      btn.addEventListener("click", () => {
        fillStatusOptions();
        applyTitles();
        if (state.role) {
          els["role-badge"].textContent = t("role." + state.role);
          renderAll();
        }
      });
    });
    window.addEventListener("load", scheduleLinks);
    window.addEventListener("resize", scheduleLinks);
    if (document.fonts && document.fonts.ready) document.fonts.ready.then(scheduleLinks);
  }

  // Загальний трекер жесту: поріг руху, потім start → move → end; без руху — click
  function beginGesture(e, handlers, threshold = 4) {
    const sx = e.clientX, sy = e.clientY, id = e.pointerId;
    let started = false;
    const move = (ev) => {
      if (ev.pointerId !== id) return;
      const dx = ev.clientX - sx, dy = ev.clientY - sy;
      if (!started) {
        if (Math.hypot(dx, dy) < threshold) return;
        started = true;
        if (handlers.start) handlers.start(ev);
      }
      if (handlers.move) handlers.move(ev, dx, dy);
    };
    const up = (ev) => {
      if (ev.pointerId !== id) return;
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      window.removeEventListener("pointercancel", up);
      if (started) { if (handlers.end) handlers.end(ev, ev.type === "pointercancel"); }
      else if (handlers.click) handlers.click(ev);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    window.addEventListener("pointercancel", up);
  }

  function panGesture() {
    let base;
    return {
      start() { base = { ...state.view }; els["viewport"].classList.add("is-panning"); },
      move(ev, dx, dy) { setView({ x: base.x + dx, y: base.y + dy, s: base.s }); },
      end() { els["viewport"].classList.remove("is-panning"); },
    };
  }

  // Перетягування блоку віхи (лише Admin/Editor); позиція зберігається на сервері
  function blockGesture(blockEl) {
    const m = milestoneById(parseInt(blockEl.dataset.block, 10));
    let base;
    return {
      start() { base = { x: m.x, y: m.y }; blockEl.classList.add("is-dragging"); },
      move(ev, dx, dy) {
        m.x = Math.round(base.x + dx / state.view.s);
        m.y = Math.round(base.y + dy / state.view.s);
        blockEl.style.left = m.x + "px";
        blockEl.style.top = m.y + "px";
        scheduleLinks();
      },
      async end(ev, cancelled) {
        blockEl.classList.remove("is-dragging");
        if (cancelled) { m.x = base.x; m.y = base.y; renderBlocks(); renderLinks(); return; }
        try {
          await API.updateMilestone(m.id, { pos_x: m.x, pos_y: m.y });
          m.pos_x = m.x; m.pos_y = m.y;
        } catch (err) { toast(humanError(err), true); }
      },
    };
  }

  // Створення залежності: тягнемо від кружечка блоку/чіпа до іншого блоку/чіпа
  function linkGesture(sourceEl) {
    const kind = sourceEl.dataset.linkKind;
    const sourceId = parseInt(sourceEl.dataset.linkId, 10);
    let hover = null;
    const draft = els["link-draft"];
    return {
      start() { draft.hidden = false; document.body.classList.add("rm-linking"); },
      move(ev) {
        const from = worldRect(sourceEl);
        const p = clientToWorld(ev.clientX, ev.clientY);
        const sx = from.x + from.w, sy = from.y + from.h / 2;
        const dx = Math.max(40, Math.abs(p.x - sx) / 2);
        draft.setAttribute("d", `M${sx} ${sy} C${sx + dx} ${sy} ${p.x - dx} ${p.y} ${p.x} ${p.y}`);
        const target = linkTargetAt(ev.clientX, ev.clientY, kind, sourceEl);
        if (hover !== target) {
          if (hover) hover.classList.remove("rm-link-target");
          hover = target;
          if (hover) hover.classList.add("rm-link-target");
        }
      },
      async end(ev, cancelled) {
        draft.hidden = true;
        draft.setAttribute("d", "");
        document.body.classList.remove("rm-linking");
        if (hover) hover.classList.remove("rm-link-target");
        const target = cancelled ? null : linkTargetAt(ev.clientX, ev.clientY, kind, sourceEl);
        if (!target) return;
        const targetId = parseInt(target.dataset.linkId, 10);
        try {
          await API.createDependency(state.projectId, {
            entity: kind, predecessor_id: sourceId, successor_id: targetId, type: "FS",
          });
          await reloadRoadmap();
          renderAll();
        } catch (err) { toast(humanError(err), true); }
      },
    };
  }

  function linkTargetAt(x, y, kind, sourceEl) {
    for (const el of document.elementsFromPoint(x, y)) {
      const cand = el.closest && el.closest(`[data-link-kind="${kind}"]`);
      if (cand && cand !== sourceEl) return cand;
    }
    return null;
  }

  // Перетягування тікета на віху (або у беклог — зняти з віхи)
  function ticketGesture(chipEl) {
    const ticket = ticketById(parseInt(chipEl.dataset.ticketId, 10));
    let ghost = null, over = null;
    const clear = () => { if (over) over.classList.remove("rm-drop-over"); over = null; };
    const pick = (x, y) => {
      for (const el of document.elementsFromPoint(x, y)) {
        const block = el.closest && el.closest(".rm-block");
        if (block) return block;
        const backlog = el.closest && el.closest("#rm-backlog");
        if (backlog) return backlog;
      }
      return null;
    };
    return {
      start(ev) {
        if (!ticket) return;
        ghost = chipEl.cloneNode(true);
        ghost.classList.add("rm-ghost");
        ghost.querySelectorAll(".rm-handle").forEach((h) => h.remove());
        document.body.appendChild(ghost);
        document.body.classList.add("rm-dragging-ticket");
        chipEl.classList.add("is-lifted");
      },
      move(ev) {
        if (!ghost) return;
        ghost.style.left = ev.clientX + "px";
        ghost.style.top = ev.clientY + "px";
        const target = pick(ev.clientX, ev.clientY);
        if (target !== over) { clear(); over = target; if (over) over.classList.add("rm-drop-over"); }
      },
      async end(ev, cancelled) {
        const target = cancelled || !ticket ? null : pick(ev.clientX, ev.clientY);
        if (ghost) ghost.remove();
        document.body.classList.remove("rm-dragging-ticket");
        chipEl.classList.remove("is-lifted");
        clear();
        if (!target) return;
        const toMilestone = target.classList.contains("rm-block") ? parseInt(target.dataset.block, 10) : null;
        if ((ticket.milestone_id || null) === toMilestone) return;
        try {
          const updated = await API.setTicketMilestone(ticket.id, toMilestone);
          Object.assign(ticket, { milestone_id: updated.milestone_id, column: updated.column || ticket.column });
          await reloadRoadmap({ pulse: true });   // сервер вже перерахував прогрес і статуси
          renderAll();
          toast(toMilestone
            ? t("rm.toast.moved", { title: (milestoneById(toMilestone) || {}).title || "" })
            : t("rm.toast.unassigned"));
        } catch (err) { toast(humanError(err), true); }
      },
    };
  }

  async function autoLayoutAll() {
    const layout = Core.autoLayout(state.milestones,
      state.deps.filter((d) => d.entity === "milestone"));
    const items = [];
    for (const m of state.milestones) {
      m.x = layout[m.id].x; m.y = layout[m.id].y;
      m.pos_x = m.x; m.pos_y = m.y;
      items.push({ id: m.id, x: m.x, y: m.y });
    }
    renderBlocks();
    renderLinks();
    fit();
    try { if (items.length) await API.saveRoadmapLayout(state.projectId, items); }
    catch (err) { toast(humanError(err), true); }
  }

  // ------------------------------------------------------------
  // Спливаюче меню залежності
  // ------------------------------------------------------------
  function showPopover(depId, cx, cy) {
    const dep = state.deps.find((d) => d.id === depId);
    if (!dep) return;
    const name = (id) => dep.entity === "milestone"
      ? (milestoneById(id) || {}).title || "#" + id
      : (ticketById(id) || {}).key || "#" + id;
    const bad = dep.state === "violated" || dep.schedule_conflict;
    const stateText = [t("rm.dep.state." + dep.state)];
    if (dep.schedule_conflict) stateText.push(t("rm.dep.conflict"));

    const types = DEP_TYPES.map((tp) =>
      `<button type="button" class="btn btn-sm ${tp === dep.type ? "btn-primary" : "btn-soft"}" data-type="${tp}"` +
      ` title="${esc(t("rm.dep." + tp + ".desc"))}"${state.canPlan ? "" : " disabled"}>${tp}</button>`).join("");

    els["popover"].innerHTML =
      `<div class="rm-pop-title">${esc(t("rm.dep.title"))}` +
        `${dep.entity === "ticket" ? " · " + esc(t("rm.dep.ticket")) : ""}</div>` +
      `<div class="rm-pop-flow">${esc(name(dep.predecessor_id))} <span class="muted">→</span> ${esc(name(dep.successor_id))}</div>` +
      `<div class="rm-pop-state ${bad ? "is-bad" : dep.state === "waiting" ? "is-wait" : "is-ok"}">${esc(stateText.join(" · "))}</div>` +
      `<div class="rm-pop-label">${esc(t("rm.dep.type"))}: ${esc(t("rm.dep." + dep.type))}</div>` +
      `<div class="rm-pop-types">${types}</div>` +
      `<div class="muted rm-pop-desc">${esc(t("rm.dep." + dep.type + ".desc"))}</div>` +
      (state.canPlan ? `<button type="button" class="btn btn-danger btn-sm btn-block" data-del>${esc(t("rm.dep.delete"))}</button>` : "");

    const pop = els["popover"];
    pop.hidden = false;
    const w = pop.offsetWidth, h = pop.offsetHeight;
    pop.style.left = Math.max(8, Math.min(cx + 12, window.innerWidth - w - 8)) + "px";
    pop.style.top = Math.max(8, Math.min(cy + 12, window.innerHeight - h - 8)) + "px";

    pop.onclick = async (e) => {
      const typeBtn = e.target.closest("[data-type]");
      const del = e.target.closest("[data-del]");
      try {
        if (typeBtn && typeBtn.dataset.type !== dep.type) {
          await API.updateDependency(dep.id, typeBtn.dataset.type);
          await reloadRoadmap();
          renderAll();
          hidePopover();
        } else if (del) {
          await API.deleteDependency(dep.id);
          await reloadRoadmap();
          renderAll();
          hidePopover();
        }
      } catch (err) { toast(humanError(err), true); }
    };
  }

  function hidePopover() { els["popover"].hidden = true; els["popover"].onclick = null; }

  // ------------------------------------------------------------
  // Модалка віхи
  // ------------------------------------------------------------
  function openModal(m) {
    state.editing = m;
    $("rm-modal-title").textContent = t(m ? "rm.modal.edit" : "rm.modal.new");
    $("rm-f-title").value = m ? m.title : "";
    $("rm-f-desc").value = m && m.description ? m.description : "";
    $("rm-f-start").value = m && m.start_date ? m.start_date : "";
    $("rm-f-due").value = m && m.due_date ? m.due_date : "";
    $("rm-f-status").value = m ? m.status : "planned";
    $("rm-f-progress").value = m ? m.progress : 0;
    const closed = !!(m && m.is_closed);
    const auto = !!(m && m.auto_managed);
    $("rm-f-status").disabled = auto || closed;
    $("rm-f-progress").disabled = auto || closed;
    [...$("rm-f-status").options].forEach((o) => { if (o.value === "done") o.disabled = !closed; });
    $("rm-f-auto").textContent = t(closed ? "rm.closed_hint" : "rm.auto_hint");
    $("rm-f-auto").hidden = !(auto || closed);
    $("rm-f-delete").hidden = !m;
    els["form-error"].textContent = "";
    els["modal-backdrop"].classList.add("open");
    setTimeout(() => $("rm-f-title").focus(), 30);
  }

  function closeModal() {
    els["modal-backdrop"].classList.remove("open");
    state.editing = null;
  }

  async function submitModal(e) {
    e.preventDefault();
    const m = state.editing;
    const payload = {
      title: $("rm-f-title").value.trim(),
      description: $("rm-f-desc").value.trim() || null,
      start_date: $("rm-f-start").value || null,
      due_date: $("rm-f-due").value || null,
    };
    if (!payload.title) return;
    if (payload.start_date && payload.due_date && payload.due_date < payload.start_date) {
      els["form-error"].textContent = t("rm.field.due") + " < " + t("rm.field.start");
      return;
    }
    if (!m || !(m.auto_managed || m.is_closed)) {
      payload.status = $("rm-f-status").value;
      const progress = parseInt($("rm-f-progress").value, 10);
      if (isFinite(progress)) payload.progress = Math.min(100, Math.max(0, progress));
    }
    try {
      if (m) {
        await API.updateMilestone(m.id, payload);
      } else {
        // нова віха з'являється у центрі поточного вигляду
        const rect = els["viewport"].getBoundingClientRect();
        const c = clientToWorld(rect.left + rect.width / 2, rect.top + rect.height / 2);
        payload.pos_x = Math.round(c.x - 150 + (state.milestones.length % 5) * 24);
        payload.pos_y = Math.round(c.y - 80 + (state.milestones.length % 5) * 24);
        await API.createMilestone(state.projectId, payload);
      }
      closeModal();
      await reloadRoadmap();
      renderAll();
    } catch (err) {
      els["form-error"].textContent = humanError(err);
    }
  }

  async function toggleClosed(m, action) {
    if (!window.confirm(t("rm." + action + "_confirm", { title: m.title }))) return;
    try {
      await (action === "close" ? API.closeMilestone(m.id) : API.reopenMilestone(m.id));
      await reloadRoadmap();
      renderAll();
    } catch (err) { toast(humanError(err), true); }
  }

  async function deleteEditing() {
    const m = state.editing;
    if (!m) return;
    if (!window.confirm(t("rm.delete_confirm", { title: m.title }))) return;
    try {
      await API.deleteMilestone(m.id);
      // тікети віхи втратили зв'язок — синхронізуємо локальний стан
      state.tickets.forEach((tk) => { if (tk.milestone_id === m.id) tk.milestone_id = null; });
      closeModal();
      await reloadRoadmap();
      renderAll();
    } catch (err) {
      els["form-error"].textContent = humanError(err);
    }
  }

  // ------------------------------------------------------------
  // Повідомлення
  // ------------------------------------------------------------
  function humanError(err) {
    const msg = String((err && err.message) || "");
    if (err && err.status === 403) return t("rm.err.forbidden");
    if (/cycle/i.test(msg)) return t("rm.err.cycle");
    if (/already exists/i.test(msg)) return t("rm.err.duplicate");
    if (/itself/i.test(msg)) return t("rm.err.self");
    return msg || t("rm.err.generic");
  }

  let toastTimer = 0;
  function toast(message, isError) {
    const el = els["toast"];
    el.textContent = message;
    el.classList.toggle("is-error", !!isError);
    el.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { el.hidden = true; }, 3200);
  }

  function showError(message) {
    els["error"].textContent = "⚠️ " + message;
    els["error"].hidden = false;
  }

  // для автотестів / відладки
  window.__rm = { state, fit, setView, renderAll, reloadRoadmap };
})();
