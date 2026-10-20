/* ============================================================
   Rapid Task — Roadmap: чисте ядро полотна (без DOM)
   Масштаб/зум до курсора, рівні semantic zoom, геометрія стрілок
   залежностей, авто-розкладка за шарами, "вписати все у вікно".
   Працює і в браузері (window.RoadmapCore), і в Node (module.exports) —
   тому покрито unit-тестами (tests/roadmap-core.test.js).
   ============================================================ */
(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.RoadmapCore = api;
})(typeof self !== "undefined" ? self : this, function () {
  const MIN_SCALE = 0.2;
  const MAX_SCALE = 2;
  const FAR_BELOW = 0.45;   // менше — "пташиний політ": лише назва, прогрес, бейджі
  const MICRO_AT = 0.8;     // від цього масштабу — видно внутрішні тікети

  const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

  // Рівень semantic zoom за масштабом
  function levelFor(scale) {
    if (scale < FAR_BELOW) return "far";
    if (scale < MICRO_AT) return "macro";
    return "micro";
  }

  // Зум відносно точки (cx, cy) у координатах в'юпорта: точка світу під курсором лишається на місці
  function zoomAt(view, factor, cx, cy, min = MIN_SCALE, max = MAX_SCALE) {
    const s = clamp(view.s * factor, min, max);
    const wx = (cx - view.x) / view.s;
    const wy = (cy - view.y) / view.s;
    return { x: cx - wx * s, y: cy - wy * s, s };
  }

  // Рамка, що охоплює набір прямокутників {x,y,w,h}
  function bboxOf(rects) {
    if (!rects.length) return null;
    let x1 = Infinity, y1 = Infinity, x2 = -Infinity, y2 = -Infinity;
    for (const r of rects) {
      x1 = Math.min(x1, r.x); y1 = Math.min(y1, r.y);
      x2 = Math.max(x2, r.x + r.w); y2 = Math.max(y2, r.y + r.h);
    }
    return { x: x1, y: y1, w: x2 - x1, h: y2 - y1 };
  }

  // Вид, що вміщує рамку у в'юпорт з відступом; масштаб не більший за maxScale
  function fitView(box, vw, vh, pad = 60, maxScale = 1) {
    if (!box || vw <= 0 || vh <= 0) return { x: 60, y: 60, s: 1 };
    const s = clamp(Math.min((vw - pad * 2) / Math.max(box.w, 1),
                             (vh - pad * 2) / Math.max(box.h, 1)), MIN_SCALE, maxScale);
    return {
      s,
      x: (vw - box.w * s) / 2 - box.x * s,
      y: (vh - box.h * s) / 2 - box.y * s,
    };
  }

  // Геометрія стрілки між двома прямокутниками {x,y,w,h} (координати світу).
  // Обирає сторони з'єднання за взаємним розташуванням і будує кубічну криву Без'є.
  function edgeGeometry(a, b, gap = 24) {
    let x1, y1, x2, y2, c1x, c1y, c2x, c2y;
    if (b.x >= a.x + a.w + gap) {              // b правіше: справа -> зліва
      x1 = a.x + a.w; y1 = a.y + a.h / 2; x2 = b.x; y2 = b.y + b.h / 2;
      const dx = Math.max(40, (x2 - x1) / 2);
      c1x = x1 + dx; c1y = y1; c2x = x2 - dx; c2y = y2;
    } else if (b.x + b.w <= a.x - gap) {       // b лівіше: зліва -> справа
      x1 = a.x; y1 = a.y + a.h / 2; x2 = b.x + b.w; y2 = b.y + b.h / 2;
      const dx = Math.max(40, (x1 - x2) / 2);
      c1x = x1 - dx; c1y = y1; c2x = x2 + dx; c2y = y2;
    } else if (b.y >= a.y) {                   // перекриття по X, b нижче
      x1 = a.x + a.w / 2; y1 = a.y + a.h; x2 = b.x + b.w / 2; y2 = b.y;
      const dy = Math.max(40, Math.abs(y2 - y1) / 2);
      c1x = x1; c1y = y1 + dy; c2x = x2; c2y = y2 - dy;
    } else {                                   // перекриття по X, b вище
      x1 = a.x + a.w / 2; y1 = a.y; x2 = b.x + b.w / 2; y2 = b.y + b.h;
      const dy = Math.max(40, Math.abs(y2 - y1) / 2);
      c1x = x1; c1y = y1 - dy; c2x = x2; c2y = y2 + dy;
    }
    return {
      x1, y1, x2, y2, c1x, c1y, c2x, c2y,
      d: `M${r(x1)} ${r(y1)} C${r(c1x)} ${r(c1y)} ${r(c2x)} ${r(c2y)} ${r(x2)} ${r(y2)}`,
      mid: { x: (x1 + 3 * c1x + 3 * c2x + x2) / 8, y: (y1 + 3 * c1y + 3 * c2y + y2) / 8 },
    };
  }
  const r = (n) => Math.round(n * 10) / 10;

  // Авто-розкладка за шарами: глибина = довжина найдовшого ланцюжка залежностей.
  // milestones: [{id}], deps: [{predecessor_id, successor_id}] (лише між віхами)
  // Повертає {id: {x, y}}. Цикли не ламають розкладку (вузли отримують глибину 0).
  function autoLayout(milestones, deps, opts = {}) {
    const { colW = 400, rowH = 380, x0 = 80, y0 = 80 } = opts;
    const ids = milestones.map((m) => m.id);
    const idSet = new Set(ids);
    const succ = new Map(ids.map((i) => [i, []]));
    const indeg = new Map(ids.map((i) => [i, 0]));
    for (const d of deps) {
      if (!idSet.has(d.predecessor_id) || !idSet.has(d.successor_id)) continue;
      succ.get(d.predecessor_id).push(d.successor_id);
      indeg.set(d.successor_id, indeg.get(d.successor_id) + 1);
    }
    const depth = new Map(ids.map((i) => [i, 0]));
    const queue = ids.filter((i) => indeg.get(i) === 0);
    const seen = new Set();
    while (queue.length) {
      const n = queue.shift();
      seen.add(n);
      for (const s of succ.get(n)) {
        depth.set(s, Math.max(depth.get(s), depth.get(n) + 1));
        indeg.set(s, indeg.get(s) - 1);
        if (indeg.get(s) === 0) queue.push(s);
      }
    }
    const layers = new Map();
    for (const id of ids) {
      const d = seen.has(id) ? depth.get(id) : 0;
      if (!layers.has(d)) layers.set(d, []);
      layers.get(d).push(id);
    }
    const out = {};
    for (const [d, list] of layers) {
      list.forEach((id, row) => { out[id] = { x: x0 + d * colW, y: y0 + row * rowH }; });
    }
    return out;
  }

  return { MIN_SCALE, MAX_SCALE, FAR_BELOW, MICRO_AT, clamp, levelFor, zoomAt,
           bboxOf, fitView, edgeGeometry, autoLayout };
});
