/* ============================================================
   Rapid Task Platform — the Overview section (needs the "Analytics" permission)
   Stat tiles, line charts per day, bar charts, and a table view of every chart.
   The charts are plain SVG / HTML (no chart library). Names and numbers are shown as text, never as HTML.
   ============================================================ */
const PL_MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
function plDay(iso, withYear) {                       // "2026-11-04" -> "04 Nov" (or "04 Nov 2026"); the date is UTC, no time zone shift
  const m = /^(\d{4})-(\d\d)-(\d\d)$/.exec(iso || "");
  if (!m) return "—";
  return `${m[3]} ${PL_MONTHS[Number(m[2]) - 1]}` + (withYear ? ` ${m[1]}` : "");
}
const plNum = (v) => Number(v || 0).toLocaleString("en-GB");
function plNiceMax(max) {                             // the top of the y axis: 1, 2, 3, 4, 5, 6, 8, 10, 20 ...
  if (max <= 1) return 1;
  const pow = Math.pow(10, Math.floor(Math.log10(max)));
  for (const f of [1, 2, 3, 4, 5, 6, 8, 10]) if (f * pow >= max) return f * pow;
  return 10 * pow;
}

/* ---------------------------------------------------------------- one line per day
   props: id, title, summary (text under the title), days (YYYY-MM-DD), values (null = no data), color (CSS variable), unit */
const PlLineChart = {
  name: "PlLineChart",
  props: { id: String, title: String, summary: String, note: String, days: Array, values: Array, color: String, unit: String },
  data() { return { hover: null, table: false, size: { w: 0, h: 0 } }; },
  computed: {
    W() { return this.size.w >= 200 ? this.size.w : 480; },     // the real size of the chart area, so the data is drawn to fit it
    H() { return this.size.h >= 100 ? this.size.h : 190; },
    m: () => ({ l: 38, r: 18, t: 18, b: 26 }),
    iw() { return this.W - this.m.l - this.m.r; },
    ih() { return this.H - this.m.t - this.m.b; },
    n() { return this.values.length; },
    top() { return plNiceMax(Math.max(0, ...this.values.map((v) => v || 0))); },
    ticks() {
      const t = [0];
      if (this.top % 2 === 0 && this.top >= 2) t.push(this.top / 2);
      t.push(this.top);
      return t.map((v) => ({ v, y: this.yOf(v) }));
    },
    segments() {                                      // runs of days that have data; a gap (null) breaks the line
      const out = []; let run = [];
      this.values.forEach((v, i) => {
        if (v === null || v === undefined) { if (run.length) out.push(run); run = []; } else run.push(i);
      });
      if (run.length) out.push(run);
      return out;
    },
    linePath() { return this.segments.map((seg) => seg.map((i, k) => `${k ? "L" : "M"}${this.xOf(i).toFixed(1)} ${this.yOf(this.values[i]).toFixed(1)}`).join(" ")).join(" "); },
    areaPath() {
      const base = this.yOf(0);
      return this.segments.filter((s) => s.length > 1).map((seg) => {
        const line = seg.map((i, k) => `${k ? "L" : "M"}${this.xOf(i).toFixed(1)} ${this.yOf(this.values[i]).toFixed(1)}`).join(" ");
        return `${line} L${this.xOf(seg[seg.length - 1]).toFixed(1)} ${base} L${this.xOf(seg[0]).toFixed(1)} ${base} Z`;
      }).join(" ");
    },
    lastIndex() { for (let i = this.n - 1; i >= 0; i--) if (this.values[i] !== null && this.values[i] !== undefined) return i; return null; },
    xLabels() {
      if (!this.n) return [];
      const mid = Math.floor((this.n - 1) / 2);
      return [{ i: 0, a: "start" }, { i: mid, a: "middle" }, { i: this.n - 1, a: "end" }].map((x) => ({ ...x, x: this.xOf(x.i), text: plDay(this.days[x.i]) }));
    },
    label() {
      const have = this.values.filter((v) => v !== null && v !== undefined);
      return `${this.title}: ${this.summary || ""}. ${have.length ? "Highest " + plNum(Math.max(...have)) + " in one day." : "No data."}`;
    },
    tipLeft() { return this.hover === null ? 0 : (this.xOf(this.hover) / this.W) * 100; },
  },
  watch: { table() { this.$nextTick(() => this.observe()); } },
  mounted() { this.observe(); },
  beforeUnmount() { if (this._ro) this._ro.disconnect(); },
  methods: {
    plNum,
    plDay,
    observe() {
      if (this._ro) { this._ro.disconnect(); this._ro = null; }
      const el = this.$refs.body;
      if (!el || typeof ResizeObserver === "undefined") return;
      const take = () => { const r = el.getBoundingClientRect(); this.size = { w: Math.round(r.width), h: Math.round(r.height) }; };
      this._ro = new ResizeObserver(take);
      this._ro.observe(el);
      take();
    },
    xOf(i) { return this.m.l + (this.n > 1 ? (this.iw * i) / (this.n - 1) : this.iw / 2); },
    yOf(v) { return this.m.t + this.ih * (1 - Math.min(v, this.top) / this.top); },
    has(i) { return this.values[i] !== null && this.values[i] !== undefined; },
    onMove(e) {                                       // the crosshair snaps to the nearest day
      const box = this.$refs.svg.getBoundingClientRect();
      const x = ((e.clientX - box.left) / box.width) * this.W;
      const i = Math.max(0, Math.min(this.n - 1, Math.round(((x - this.m.l) / this.iw) * (this.n - 1))));
      this.hover = this.has(i) ? i : null;
    },
    onKey(e) {
      if (e.key !== "ArrowLeft" && e.key !== "ArrowRight" && e.key !== "Escape") return;
      e.preventDefault();
      if (e.key === "Escape") { this.hover = null; return; }
      const step = e.key === "ArrowRight" ? 1 : -1;
      let i = this.hover === null ? (step > 0 ? -1 : this.n) : this.hover;
      do { i += step; } while (i >= 0 && i < this.n && !this.has(i));
      if (i >= 0 && i < this.n) this.hover = i;
    },
  },
  template: `
  <article class="pl-card pl-chart" :data-testid="id" :style="{ '--c': 'var(' + color + ')' }">
    <header class="pl-chart-head">
      <div>
        <h2>{{ title }}</h2>
        <span class="pl-muted" :data-testid="id + '-total'">{{ summary }}</span>
      </div>
      <button type="button" class="btn btn-ghost btn-sm" :data-testid="id + '-toggle'" @click="table = !table; hover = null">{{ table ? "Chart" : "Table" }}</button>
    </header>
    <p class="pl-muted" v-if="note" :data-testid="id + '-note'">{{ note }}</p>

    <div class="pl-chart-body" ref="body" v-if="!table">
      <svg ref="svg" :viewBox="'0 0 ' + W + ' ' + H" role="img" :aria-label="label" tabindex="0" :data-testid="id + '-svg'"
           @pointermove="onMove" @pointerdown="onMove" @pointerleave="hover = null" @blur="hover = null" @keydown="onKey">
        <g v-for="t in ticks" :key="t.v">
          <line class="pl-grid-line" :x1="m.l" :x2="W - m.r" :y1="t.y" :y2="t.y"></line>
          <text class="pl-axis-text" :x="m.l - 8" :y="t.y + 4" text-anchor="end">{{ plNum(t.v) }}</text>
        </g>
        <text class="pl-axis-text" v-for="l in xLabels" :key="l.i" :x="l.x" :y="H - 8" :text-anchor="l.a">{{ l.text }}</text>
        <path class="pl-area" :d="areaPath" v-if="areaPath"></path>
        <path class="pl-line" :d="linePath" v-if="linePath" :data-testid="id + '-line'"></path>
        <g v-if="lastIndex !== null">
          <circle class="pl-dot" :cx="xOf(lastIndex)" :cy="yOf(values[lastIndex])" r="4"></circle>
          <text class="pl-end-text" :data-testid="id + '-end'" :x="xOf(lastIndex)" :y="yOf(values[lastIndex]) - 10" text-anchor="end">{{ plNum(values[lastIndex]) }}</text>
        </g>
        <g v-if="hover !== null">
          <line class="pl-cross" :x1="xOf(hover)" :x2="xOf(hover)" :y1="m.t" :y2="H - m.b"></line>
          <circle class="pl-dot" :cx="xOf(hover)" :cy="yOf(values[hover])" r="5"></circle>
        </g>
      </svg>
      <div class="pl-tip" v-if="hover !== null" :data-testid="id + '-tip'" :style="{ left: tipLeft + '%', top: '0', transform: tipLeft > 60 ? 'translateX(-105%)' : 'translateX(8px)' }">
        <strong data-testid="tip-value">{{ plNum(values[hover]) }}</strong>
        <span><i class="pl-key"></i>{{ unit }}</span><br>
        <span data-testid="tip-date">{{ plDay(days[hover], true) }}</span>
      </div>
    </div>

    <div class="pl-table-wrap pl-chart-table" v-else>
      <table class="pl-table" :data-testid="id + '-table'">
        <thead><tr><th>Day</th><th class="pl-num">{{ unit }}</th></tr></thead>
        <tbody>
          <tr v-for="(d, i) in days" :key="d" :data-testid="id + '-row'">
            <td class="pl-nowrap">{{ plDay(d, true) }}</td><td class="pl-num">{{ has(i) ? plNum(values[i]) : "—" }}</td>
          </tr>
        </tbody>
      </table>
    </div>
  </article>`,
};

/* ---------------------------------------------------------------- horizontal bars
   props: id, title, summary, items [{label, value, tone: "a"|"b"}], legend [{tone, label}], unit */
const PlBarChart = {
  name: "PlBarChart",
  props: { id: String, title: String, summary: String, items: Array, legend: Array, unit: String },
  data() { return { table: false }; },
  computed: {
    max() { return Math.max(1, ...this.items.map((i) => i.value)); },
    sum() { return this.items.reduce((a, i) => a + i.value, 0); },
  },
  methods: {
    plNum,
    ratio(v) { return v / this.max; },
    share(v) { return this.sum ? Math.round((v * 1000) / this.sum) / 10 : 0; },
  },
  template: `
  <article class="pl-card pl-chart" :data-testid="id">
    <header class="pl-chart-head">
      <div>
        <h2>{{ title }}</h2>
        <span class="pl-muted" :data-testid="id + '-total'">{{ summary }}</span>
      </div>
      <button type="button" class="btn btn-ghost btn-sm" :data-testid="id + '-toggle'" @click="table = !table">{{ table ? "Chart" : "Table" }}</button>
    </header>
    <template v-if="!table">
      <ul class="pl-legend" v-if="legend && legend.length > 1" :data-testid="id + '-legend'">
        <li v-for="l in legend" :key="l.tone"><i class="pl-lg-swatch" :class="'tone-' + l.tone"></i>{{ l.label }}</li>
      </ul>
      <p class="pl-muted" v-if="!items.length" :data-testid="id + '-empty'">No tickets yet.</p>
      <ul class="pl-hb-list" :data-testid="id + '-bars'" v-else>
        <li class="pl-hb-row" v-for="it in items" :key="it.label" tabindex="0" :data-testid="id + '-row'" :data-label="it.label" :data-value="it.value"
            :style="{ '--r': ratio(it.value) }" :aria-label="it.label + ': ' + it.value + ' ' + unit">
          <span class="pl-hb-label" :title="it.label" data-testid="bar-label">{{ it.label }}</span>
          <span class="pl-hb-track">
            <span class="pl-hb" :class="['tone-' + it.tone, { has: it.value > 0 }]" data-testid="bar"></span>
            <span class="pl-hb-value" data-testid="bar-value">{{ plNum(it.value) }}</span>
          </span>
          <span class="pl-tip" data-testid="bar-tip"><strong>{{ plNum(it.value) }} {{ unit }}</strong>{{ it.label }} · {{ share(it.value) }}%</span>
        </li>
      </ul>
    </template>
    <div class="pl-table-wrap pl-chart-table" v-else>
      <table class="pl-table" :data-testid="id + '-table'">
        <thead><tr><th>Name</th><th class="pl-num">{{ unit }}</th><th class="pl-num">Share</th></tr></thead>
        <tbody>
          <tr v-for="it in items" :key="it.label" :data-testid="id + '-trow'">
            <td>{{ it.label }}</td><td class="pl-num">{{ plNum(it.value) }}</td><td class="pl-num">{{ share(it.value) }}%</td>
          </tr>
        </tbody>
      </table>
    </div>
  </article>`,
};

/* ---------------------------------------------------------------- the page */
const PlatformOverview = {
  name: "PlatformOverview",

  data() {
    let days = 30;
    try { const saved = Number(localStorage.getItem("rt_platform_overview_days")); if ([7, 30, 90].includes(saved)) days = saved; } catch (_) { /* private mode */ }
    return { days, o: null, loading: true, busy: false, loadError: "", updatedAt: null, periods: [7, 30, 90] };
  },

  computed: {
    layoutCustom() { return PlLayout.isCustom("overview"); },
    s() { return this.o.series; },
    sum() { return (key) => this.o.series[key].reduce((a, v) => a + v, 0); },
    activeValues() {                                  // before the first saved day there is no data (not zero)
      const since = this.o.activity_since;
      return this.s.active_users.map((v, i) => (since && this.s.days[i] >= since ? v : null));
    },
    activeNote() {
      const since = this.o.activity_since;
      if (!since) return "No activity is saved yet. The chart fills as people use the app.";
      if (since > this.s.days[0]) return `Counted since ${plDay(since, true)}.`;
      return "";
    },
    statusItems() { return this.o.tickets_by_status.map((x) => ({ label: x.name, value: x.count, tone: x.is_done ? "b" : "a" })); },
    typeItems() { return this.o.tickets_by_type.map((x) => ({ label: x.type, value: x.count, tone: "a" })); },
    updatedText() {
      if (!this.updatedAt) return "";
      const d = this.updatedAt, p = (n) => String(n).padStart(2, "0");
      return `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
    },
  },

  methods: {
    resetLayout() { PlLayout.reset("overview"); },
    plNum,
    async load(silent) {
      const ticket = (this._ticket = (this._ticket || 0) + 1);       // a slow old answer must not replace a newer one
      if (!silent && !this.o) this.loading = true;
      this.busy = true;
      try {
        const data = await PlatformAPI.overview(this.days);
        if (ticket !== this._ticket) return;
        this.o = data;
        this.loadError = "";
        this.updatedAt = new Date();
      } catch (err) {
        if (ticket !== this._ticket) return;
        if (err.status !== 401) this.loadError = err.message;          // the old numbers stay on the screen
      } finally {
        if (ticket === this._ticket) { this.loading = false; this.busy = false; }
      }
    },
    setDays(n) {
      if (n === this.days) return;
      this.days = n;
      try { localStorage.setItem("rt_platform_overview_days", String(n)); } catch (_) { /* not saved */ }
      this.load(true);
    },
  },

  mounted() { this.load(); },
  beforeUnmount() { this._ticket = -1; },

  template: `
  <section data-testid="overview-page">
    <div class="pl-health-top">
      <div class="pl-period" role="radiogroup" aria-label="Period" data-testid="overview-periods">
        <button v-for="p in periods" :key="p" type="button" role="radio" class="pl-tab" :class="{ on: days === p }" :aria-checked="days === p ? 'true' : 'false'"
                :data-testid="'overview-period-' + p" @click="setDays(p)">{{ p }} days</button>
      </div>
      <span class="pl-spacer"></span>
      <span class="pl-muted" data-testid="overview-updated" v-if="updatedText">Updated {{ updatedText }}</span>
      <button type="button" class="btn btn-ghost btn-sm" data-testid="layout-reset" :disabled="!layoutCustom" @click="resetLayout">Reset layout</button>
      <button type="button" class="btn btn-ghost btn-sm" data-testid="overview-refresh" @click="load(true)">Refresh</button>
    </div>

    <p class="pl-muted pl-pad" v-if="loading && !o" data-testid="overview-loading">Loading…</p>
    <div class="pl-card" v-else-if="!o">
      <p class="form-error" role="alert" data-testid="overview-error">{{ loadError }}</p>
      <button type="button" class="btn btn-ghost btn-sm" data-testid="overview-retry" @click="load()">Try again</button>
    </div>

    <div v-else class="pl-loading-frame" :class="{ 'is-loading': busy }">
      <p class="form-error" role="alert" data-testid="overview-error" v-if="loadError">Could not refresh: {{ loadError }}. The numbers below are old.</p>

      <div class="pl-board">
        <pl-item board="overview" id="tile-users" kind="tile" label="Users"><article class="pl-card pl-tile" data-testid="tile-users">
          <h2>Users</h2>
          <div class="pl-big" data-testid="users-total">{{ plNum(o.users.total) }}</div>
          <dl class="pl-kv">
            <div><dt>Active</dt><dd data-testid="users-active">{{ plNum(o.users.active) }}</dd></div>
            <div><dt>Blocked</dt><dd data-testid="users-blocked">{{ plNum(o.users.blocked) }}</dd></div>
            <div><dt>Deactivated</dt><dd data-testid="users-deactivated">{{ plNum(o.users.deactivated) }}</dd></div>
            <div><dt>New, last {{ o.period.days }} days</dt><dd data-testid="users-new">{{ plNum(o.users.new) }}</dd></div>
          </dl>
        </article></pl-item>
        <pl-item board="overview" id="tile-projects" kind="tile" label="Projects"><article class="pl-card pl-tile" data-testid="tile-projects">
          <h2>Projects</h2>
          <div class="pl-big" data-testid="projects-total">{{ plNum(o.projects.total) }}</div>
          <dl class="pl-kv">
            <div><dt>New, last {{ o.period.days }} days</dt><dd data-testid="projects-new">{{ plNum(o.projects.new) }}</dd></div>
            <div><dt>With activity</dt><dd data-testid="projects-with-activity">{{ plNum(o.projects.with_activity) }}</dd></div>
          </dl>
        </article></pl-item>
        <pl-item board="overview" id="tile-tickets" kind="tile" label="Tickets"><article class="pl-card pl-tile" data-testid="tile-tickets">
          <h2>Tickets</h2>
          <div class="pl-big" data-testid="tickets-total">{{ plNum(o.tickets.total) }}</div>
          <dl class="pl-kv">
            <div><dt>Open now</dt><dd data-testid="tickets-open">{{ plNum(o.tickets.open) }}</dd></div>
            <div><dt>Created, last {{ o.period.days }} days</dt><dd data-testid="tickets-created">{{ plNum(o.tickets.created) }}</dd></div>
            <div><dt>Done, last {{ o.period.days }} days</dt><dd data-testid="tickets-done">{{ plNum(o.tickets.done) }}</dd></div>
          </dl>
        </article></pl-item>
        <pl-item board="overview" id="tile-activity" kind="tile" label="Comments and files"><article class="pl-card pl-tile" data-testid="tile-activity">
          <h2>Comments, last {{ o.period.days }} days</h2>
          <div class="pl-big" data-testid="activity-comments">{{ plNum(o.activity.comments) }}</div>
          <dl class="pl-kv">
            <div><dt>Files attached</dt><dd data-testid="activity-attachments">{{ plNum(o.activity.attachments) }}</dd></div>
          </dl>
        </article></pl-item>

        <pl-item board="overview" id="chart-new-users" kind="chart" label="New users per day">
          <pl-line-chart id="chart-new-users" title="New users per day" unit="New users" color="--pl-s7"
            :summary="plNum(sum('new_users')) + ' in ' + o.period.days + ' days'" :days="s.days" :values="s.new_users"></pl-line-chart>
        </pl-item>
        <pl-item board="overview" id="chart-active-users" kind="chart" label="Active users per day">
          <pl-line-chart id="chart-active-users" title="Active users per day" unit="Active users" color="--pl-s3"
            :summary="'Peak ' + plNum(Math.max(0, ...s.active_users)) + ' in one day'" :note="activeNote" :days="s.days" :values="activeValues"></pl-line-chart>
        </pl-item>
        <pl-item board="overview" id="chart-new-projects" kind="chart" label="New projects per day">
          <pl-line-chart id="chart-new-projects" title="New projects per day" unit="New projects" color="--pl-s2"
            :summary="plNum(sum('new_projects')) + ' in ' + o.period.days + ' days'" :days="s.days" :values="s.new_projects"></pl-line-chart>
        </pl-item>
        <pl-item board="overview" id="chart-new-tickets" kind="chart" label="New tickets per day">
          <pl-line-chart id="chart-new-tickets" title="New tickets per day" unit="New tickets" color="--pl-s1"
            :summary="plNum(sum('new_tickets')) + ' in ' + o.period.days + ' days'" :days="s.days" :values="s.new_tickets"></pl-line-chart>
        </pl-item>

        <pl-item board="overview" id="chart-status" kind="chart" label="Tickets by status">
          <pl-bar-chart id="chart-status" title="Tickets by status" unit="tickets" :summary="'All projects, ' + plNum(o.tickets.total) + ' tickets'"
            :items="statusItems" :legend="[{ tone: 'a', label: 'Open columns' }, { tone: 'b', label: 'Done columns' }]"></pl-bar-chart>
        </pl-item>
        <pl-item board="overview" id="chart-type" kind="chart" label="Tickets by type">
          <pl-bar-chart id="chart-type" title="Tickets by type" unit="tickets" :summary="'All projects, ' + plNum(o.tickets.total) + ' tickets'"
            :items="typeItems"></pl-bar-chart>
        </pl-item>
      </div>
    </div>
  </section>`,
};
