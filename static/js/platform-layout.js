/* ============================================================
   Rapid Task Platform — movable and resizable tiles (Overview and System Health)
   - <pl-item board="overview" id="tile-users" kind="tile" label="Users"> wraps one tile / chart / card.
   - Move: drag the top handle, or focus it and use the arrow keys (Home / End = first / last).
   - Resize: drag the corner handle (any width and height), or focus it and use the arrow keys.
   - The layout is saved in this browser only (localStorage), one record per board.
   Width is saved in % of the board width, so it still fits when the window changes.
   ============================================================ */
const PL_LAYOUT_PREFIX = "rt_platform_layout_";
const PL_DEFAULT_W = { tile: 25, chart: 50, card: 33.333, wide: 100 };
const PL_MIN_W = 15, PL_MAX_W = 100, PL_MIN_H = 80, PL_MAX_H = 1600;
const PL_MIN_PX = { tile: 210, chart: 300, wide: 300, card: 260 };   // same numbers as the min-width rules in the CSS
const PL_SNAP = 12;                                    // px: how close an edge must be to a neighbour to jump to it

const PlLayout = (() => {
  const boards = {};
  const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

  function load(b) {
    try {
      const raw = JSON.parse(localStorage.getItem(PL_LAYOUT_PREFIX + b.key) || "null");
      if (!raw || typeof raw !== "object") return;
      if (Array.isArray(raw.order)) b.order = raw.order.filter((x) => typeof x === "string");
      if (raw.sizes && typeof raw.sizes === "object") {
        for (const [id, s] of Object.entries(raw.sizes)) {
          if (!s || typeof s !== "object") continue;
          const out = {};
          if (typeof s.w === "number" && isFinite(s.w)) out.w = clamp(s.w, PL_MIN_W, PL_MAX_W);
          if (typeof s.h === "number" && isFinite(s.h)) out.h = clamp(s.h, PL_MIN_H, PL_MAX_H);
          if (out.w !== undefined || out.h !== undefined) b.sizes[id] = out;
        }
      }
    } catch (_) { /* a broken record is ignored */ }
  }
  function save(b) {
    try {
      if (!b.order.length && !Object.keys(b.sizes).length) localStorage.removeItem(PL_LAYOUT_PREFIX + b.key);
      else localStorage.setItem(PL_LAYOUT_PREFIX + b.key, JSON.stringify({ order: b.order, sizes: b.sizes }));
    } catch (_) { /* not saved */ }
  }
  function board(key) {
    if (!boards[key]) {
      const b = Vue.reactive({ key, items: [], order: [], sizes: {} });
      load(b);
      boards[key] = b;
    }
    return boards[key];
  }
  function ordered(b) {                              // saved order first, then the items that are not saved yet
    const known = b.order.filter((id) => b.items.includes(id));
    return known.concat(b.items.filter((id) => !known.includes(id)));
  }
  return {
    board,
    register(b, id) { if (!b.items.includes(id)) b.items.push(id); },
    unregister(b, id) { const i = b.items.indexOf(id); if (i >= 0) b.items.splice(i, 1); },
    index(b, id) { return Math.max(0, ordered(b).indexOf(id)); },
    count(b) { return b.items.length; },
    width(b, id, kind) { const s = b.sizes[id]; return s && s.w !== undefined ? s.w : (PL_DEFAULT_W[kind] || 33.333); },
    height(b, id) { const s = b.sizes[id]; return s && s.h !== undefined ? s.h : null; },
    move(b, id, to) {
      const list = ordered(b).filter((x) => x !== id);
      list.splice(clamp(to, 0, list.length), 0, id);
      b.order = list;
      save(b);
    },
    setSize(b, id, w, h) {
      const s = Object.assign({}, b.sizes[id] || {});
      if (w !== undefined && w !== null) s.w = clamp(Math.round(w * 100) / 100, PL_MIN_W, PL_MAX_W);
      if (h !== undefined && h !== null) s.h = clamp(Math.round(h), PL_MIN_H, PL_MAX_H);
      b.sizes[id] = s;
      save(b);
    },
    isCustom(key) { const b = board(key); return b.order.length > 0 || Object.keys(b.sizes).length > 0; },
    reset(key) { const b = board(key); b.order = []; b.sizes = {}; save(b); },
  };
})();

const PlItem = {
  props: { board: { type: String, required: true }, id: { type: String, required: true }, kind: { type: String, default: "card" }, label: { type: String, default: "" } },
  data() { return { dragging: false }; },
  computed: {
    b() { return PlLayout.board(this.board); },
    idx() { return PlLayout.index(this.b, this.id); },
    w() { return PlLayout.width(this.b, this.id, this.kind); },
    h() { return PlLayout.height(this.b, this.id); },
    st() {
      const s = { order: this.idx, "--pl-w": this.w + "%" };
      if (this.h !== null) s["--pl-h"] = this.h + "px";
      return s;
    },
  },
  created() { PlLayout.register(this.b, this.id); },
  beforeUnmount() { PlLayout.unregister(this.b, this.id); },

  methods: {
    /* ---- move ---- */
    dragStart(e) {
      if (e.pointerType === "mouse" && e.button !== 0) return;
      const el = e.currentTarget;
      try { el.setPointerCapture(e.pointerId); } catch (_) { /* ok */ }
      el.focus();
      this.dragging = true;
      this._last = null;
      document.body.classList.add("pl-dragging");
      const move = (ev) => this.dragMove(ev);
      const up = () => {
        el.removeEventListener("pointermove", move);
        el.removeEventListener("pointerup", up);
        el.removeEventListener("pointercancel", up);
        this.dragging = false;
        document.body.classList.remove("pl-dragging");
      };
      el.addEventListener("pointermove", move);
      el.addEventListener("pointerup", up);
      el.addEventListener("pointercancel", up);
    },
    dragMove(ev) {
      const hit = document.elementsFromPoint(ev.clientX, ev.clientY)
        .map((n) => (n.closest ? n.closest(".pl-item") : null))
        .find((n) => n && n.dataset.board === this.board);
      if (!hit) return;
      const id = hit.dataset.item;
      if (id === this.id) { this._last = null; return; }
      if (id === this._last) return;                   // no flicker: wait until the pointer leaves that item
      this._last = id;
      PlLayout.move(this.b, this.id, PlLayout.index(this.b, id));
    },
    moveKey(e) {
      const last = PlLayout.count(this.b) - 1;
      let to = null;
      if (e.key === "ArrowLeft" || e.key === "ArrowUp") to = this.idx - 1;
      else if (e.key === "ArrowRight" || e.key === "ArrowDown") to = this.idx + 1;
      else if (e.key === "Home") to = 0;
      else if (e.key === "End") to = last;
      if (to === null) return;
      e.preventDefault();
      if (to < 0 || to > last || to === this.idx) return;
      PlLayout.move(this.b, this.id, to);
    },

    /* ---- resize ---- */
    minWidthPx() {                                    // a tile can not be narrower than its content needs (set in the CSS per kind)
      return Math.min(PL_MIN_PX[this.kind] || 260, this.$el.parentElement.clientWidth || 260);
    },
    minHeightPx() {                                   // the natural height of the content (the outer item, with its 14 px of padding)
      const item = this.$el, had = item.classList.contains("has-h"), prev = item.style.getPropertyValue("--pl-h");
      item.classList.add("has-h");
      item.style.setProperty("--pl-h", "0px");
      const h = item.getBoundingClientRect().height;
      if (!had) item.classList.remove("has-h");
      if (prev) item.style.setProperty("--pl-h", prev); else item.style.removeProperty("--pl-h");
      return h;
    },
    resizeStart(e) {
      if (e.pointerType === "mouse" && e.button !== 0) return;
      const el = e.currentTarget, item = this.$el, boardEl = item.parentElement;
      const boardW = boardEl.clientWidth || 1;
      const r = item.getBoundingClientRect();
      const x0 = e.clientX, y0 = e.clientY, w0 = r.width, h0 = r.height;
      const minW = this.minWidthPx(), minH = this.minHeightPx();
      const others = [...document.querySelectorAll(`.pl-item[data-board="${this.board}"]`)].filter((n) => n !== item).map((n) => n.getBoundingClientRect());   // where the neighbours are when the drag starts
      let touchedH = false;
      try { el.setPointerCapture(e.pointerId); } catch (_) { /* ok */ }
      el.focus();
      this.dragging = true;
      document.body.classList.add("pl-dragging");
      const gv = document.createElement("div"), gh = document.createElement("div");
      gv.className = "pl-guide pl-guide-v"; gh.className = "pl-guide pl-guide-h";
      gv.hidden = gh.hidden = true;
      document.body.append(gv, gh);
      const move = (ev) => {
        const dy = ev.clientY - y0;
        if (Math.abs(dy) > 3) touchedH = true;           // a pure sideways drag keeps the automatic height
        const cur = item.getBoundingClientRect(), br = boardEl.getBoundingClientRect();
        let wPx = Math.max(minW, w0 + ev.clientX - x0);
        let hPx = Math.max(minH, h0 + dy);
        /* fit to the neighbours: the right edge goes to a neighbour's right edge (or the same width), the bottom edge the same */
        const near = (value, from, list) => {
          let best = null;
          for (const c of list) if (Math.abs(from + value - c) <= PL_SNAP && (best === null || Math.abs(from + value - c) < Math.abs(from + value - best))) best = c;
          return best;
        };
        const xs = [br.right].concat(others.map((o) => o.right), others.map((o) => cur.left + o.width));
        const ys = others.map((o) => o.bottom).concat(others.map((o) => cur.top + o.height));
        const sx = near(wPx, cur.left, xs), sy = touchedH ? near(hPx, cur.top, ys) : null;
        gv.hidden = gh.hidden = true;
        if (sx !== null && sx - cur.left >= minW) { wPx = sx - cur.left; gv.hidden = false; gv.style.cssText = `left:${sx}px;top:${br.top}px;height:${br.height}px`; }
        if (sy !== null && sy - cur.top >= minH) { hPx = sy - cur.top; gh.hidden = false; gh.style.cssText = `top:${sy}px;left:${br.left}px;width:${br.width}px`; }
        PlLayout.setSize(this.b, this.id, (wPx / boardW) * 100, touchedH ? hPx - 14 : undefined);
      };
      const up = () => {
        el.removeEventListener("pointermove", move);
        el.removeEventListener("pointerup", up);
        el.removeEventListener("pointercancel", up);
        gv.remove(); gh.remove();
        this.dragging = false;
        document.body.classList.remove("pl-dragging");
      };
      el.addEventListener("pointermove", move);
      el.addEventListener("pointerup", up);
      el.addEventListener("pointercancel", up);
    },
    resizeKey(e) {
      const keys = ["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"];
      if (!keys.includes(e.key)) return;
      e.preventDefault();
      if (e.key === "ArrowLeft" || e.key === "ArrowRight") {
        const minPct = (this.minWidthPx() / (this.$el.parentElement.clientWidth || 1)) * 100;
        PlLayout.setSize(this.b, this.id, Math.max(minPct, this.w + (e.key === "ArrowRight" ? 5 : -5)));
      } else {
        const cur = this.h !== null ? this.h : this.$el.getBoundingClientRect().height - 14;
        PlLayout.setSize(this.b, this.id, undefined, Math.max(this.minHeightPx() - 14, cur + (e.key === "ArrowDown" ? 20 : -20)));
      }
    },
  },

  template: `
  <div class="pl-item" :class="{ 'has-h': h !== null, 'is-dragging': dragging }" :style="st"
       :data-item="id" :data-board="board" :data-kind="kind" :data-order="idx" :data-width="w" :data-height="h === null ? '' : h" :data-testid="'item-' + id">
    <div class="pl-item-box">
      <button type="button" class="pl-handle pl-move" data-testid="item-move" :aria-label="'Move ' + label + ': drag, or use the arrow keys'"
              @pointerdown.prevent="dragStart" @keydown="moveKey">
        <svg viewBox="0 0 24 8" width="22" height="8" aria-hidden="true"><circle cx="4" cy="2" r="1.4"/><circle cx="12" cy="2" r="1.4"/><circle cx="20" cy="2" r="1.4"/><circle cx="4" cy="6" r="1.4"/><circle cx="12" cy="6" r="1.4"/><circle cx="20" cy="6" r="1.4"/></svg>
      </button>
      <slot></slot>
      <button type="button" class="pl-handle pl-resize" data-testid="item-resize" :aria-label="'Resize ' + label + ': drag, or use the arrow keys'"
              @pointerdown.prevent="resizeStart" @keydown="resizeKey">
        <svg viewBox="0 0 12 12" width="12" height="12" aria-hidden="true"><path d="M11 3 3 11M11 7 7 11" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" fill="none"/></svg>
      </button>
    </div>
  </div>`,
};
