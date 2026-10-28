/* ============================================================
   Rapid Task — Backlog: table of ALL tickets of a project
   (tickets without a milestone and tickets of closed milestones included).
   - columns can be switched on/off (remembered per project)
   - filters, text search, sorting, pagination (remembered per project)
   - row click opens the shared ticket dialog; "New ticket" opens the shared create dialog
   ============================================================ */

const { createApp } = Vue;

const BL_COLUMNS = [
  { key: "type", on: true },
  { key: "key", on: true },
  { key: "title", on: true },
  { key: "author", on: true },
  { key: "assignee", on: true },
  { key: "status", on: true },
  { key: "milestone", on: true },
  { key: "tags", on: false },
  { key: "components", on: false },
  { key: "created", on: false },
];
const BL_SORTABLE = ["type", "key", "title", "author", "assignee", "status", "milestone", "created"];
const BL_PAGE_SIZES = [25, 50, 100];
const BL_DEFAULT_SORT = { key: "created", dir: "desc" };

function blDefaults() {
  const v = {};
  BL_COLUMNS.forEach((c) => { v[c.key] = c.on; });
  return v;
}

function blEmptyFilters() {
  // id 0 means "none" (no milestone / unassigned)
  return { type: null, tag_ids: [], component_ids: [], milestone_ids: [],
           assignee_ids: [], reporter_ids: [], tester_ids: [] };
}


// One table of tickets; used by the flat list and by every milestone group.
const BlTable = {
  name: "BlTable",
  props: {
    rows: { type: Array, default: () => [] },
    columns: { type: Array, default: () => [] },     // [{ key }]
    sort: { type: Object, default: () => ({}) },
    testid: { type: String, default: "backlog-table" },
    lang: { type: Number, default: 0 },              // changes on language switch, forces a re-render
  },
  emits: ["sort", "open"],
  methods: {
    typeMeta,
    i18nGet(key) { void this.lang; return i18nGet(key); },
    isSortable(key) { return BL_SORTABLE.includes(key); },
    mark(key) {
      if (this.sort.key !== key) return "";
      return this.sort.dir === "asc" ? "▲" : "▼";
    },
    ariaSort(key) {
      if (this.sort.key !== key) return "none";
      return this.sort.dir === "asc" ? "ascending" : "descending";
    },
    fmtDate(value) {
      if (!value) return "";
      const d = new Date(value);
      return isNaN(d) ? "" : d.toLocaleDateString();
    },
  },
  template: `
<table class="bl-table" :data-testid="testid">
          <thead>
            <tr>
              <th v-for="c in columns" :key="c.key" :data-col="c.key"
                  :class="{ sortable: isSortable(c.key) }" :aria-sort="ariaSort(c.key)"
                  @click="isSortable(c.key) && $emit('sort', c.key)">
                {{ i18nGet('backlog.col.' + c.key) }}
                <span class="bl-sort" v-if="mark(c.key)" :data-testid="'bl-sort-' + c.key">{{ mark(c.key) }}</span>
              </th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="t in rows" :key="t.id" tabindex="0" :data-key="t.key"
                @click="$emit('open', t)" @keydown.enter="$emit('open', t)">
              <td v-for="c in columns" :key="c.key" :data-col="c.key">
                <template v-if="c.key === 'type'"><span :title="t.type">{{ typeMeta(t.type).icon }}</span></template>
                <template v-else-if="c.key === 'key'"><span class="ticket-key">{{ t.key }}</span></template>
                <template v-else-if="c.key === 'title'"><span class="bl-title">{{ t.title }}</span></template>
                <template v-else-if="c.key === 'author'">
                  <span class="bl-user" v-if="t.reporter">
                    <user-avatar :user="t.reporter" :size="22"></user-avatar>{{ t.reporter.full_name }}
                  </span>
                </template>
                <template v-else-if="c.key === 'assignee'">
                  <span class="bl-user" v-if="t.assignee">
                    <user-avatar :user="t.assignee" :size="22"></user-avatar>{{ t.assignee.full_name }}
                  </span>
                  <span class="muted" v-else>—</span>
                </template>
                <template v-else-if="c.key === 'status'">{{ t.column ? t.column.name : '' }}</template>
                <template v-else-if="c.key === 'milestone'">
                  <span class="mini-chip" v-if="t.milestone">{{ t.milestone.title }}{{ t.milestone.is_closed ? ' ✔' : '' }}</span>
                  <span class="muted" v-else>—</span>
                </template>
                <template v-else-if="c.key === 'tags'">
                  <span class="mini-chip" v-for="x in t.tags" :key="x.id">{{ x.name }}</span>
                </template>
                <template v-else-if="c.key === 'components'">
                  <span class="mini-chip" v-for="x in t.components" :key="x.id">{{ x.name }}</span>
                </template>
                <template v-else-if="c.key === 'created'">{{ fmtDate(t.created_at) }}</template>
              </td>
            </tr>
          </tbody>
        </table>
  `,
};

const app = createApp({
  data() {
    return {
      me: null,
      role: null,
      project: null,
      projectId: NaN,
      tickets: [],
      members: [],
      tagOptions: [],
      componentOptions: [],
      milestones: [],
      loading: true,
      loaded: false,        // settings restored: from now on changes are saved
      error: "",
      showProfile: false,
      showCols: false,
      langTick: 0,
      allColumns: BL_COLUMNS,
      visible: blDefaults(),

      // shared ticket dialogs
      showCreate: false,
      createDefaults: {},
      editKey: null,

      // filters / search / sorting / pages
      filters: blEmptyFilters(),
      search: "",
      showFilters: false,
      sort: { ...BL_DEFAULT_SORT },
      pageSize: 50,
      page: 1,
      pageSizes: BL_PAGE_SIZES,
      view: "list",          // "list" | "grouped"
      collapsed: {},         // group key -> true (remembered per project)
      types: TICKET_TYPES,
    };
  },

  computed: {
    shownColumns() { return BL_COLUMNS.filter((c) => this.visible[c.key]); },
    visibleCount() { return this.shownColumns.length; },

    memberUsers() { return this.members.map((m) => m.user); },
    userOptions() { return this.memberUsers.map((u) => ({ id: u.id, name: u.full_name })); },
    assigneeOptions() {
      return [{ id: 0, name: this.i18nGet("backlog.unassigned") }, ...this.userOptions];
    },
    milestoneOptions() {
      return [{ id: 0, name: this.i18nGet("backlog.no_milestone") },
        ...this.milestones.map((m) => ({ id: m.id, name: m.title + (m.is_closed ? " ✔" : "") }))];
    },

    // how many filter fields are set (the text search is separate)
    filtersCount() {
      const f = this.filters;
      return (f.type ? 1 : 0) + [f.tag_ids, f.component_ids, f.milestone_ids,
        f.assignee_ids, f.reporter_ids, f.tester_ids].filter((a) => a.length).length;
    },
    hasFilters() { return this.filtersCount > 0 || !!this.search.trim(); },

    filtered() { return this.tickets.filter((t) => this.matches(t)); },
    sorted() {
      const { key, dir } = this.sort;
      const sign = dir === "desc" ? -1 : 1;
      return [...this.filtered].sort((a, b) => this.compare(a, b, key, sign));
    },
    groupColumns() { return this.shownColumns.filter((c) => c.key !== "milestone"); },

    // "By milestone" view: no milestone first, then open milestones, then closed ones
    groups() {
      const byMs = new Map();
      const none = [];
      for (const t of this.sorted) {
        if (!t.milestone_id) { none.push(t); continue; }
        if (!byMs.has(t.milestone_id)) byMs.set(t.milestone_id, []);
        byMs.get(t.milestone_id).push(t);
      }
      const dueKey = (m) => (m.due_date ? m.due_date : "9999-12-31");
      const open = this.milestones.filter((m) => !m.is_closed)
        .sort((a, b) => dueKey(a).localeCompare(dueKey(b)) || a.id - b.id);
      const closed = this.milestones.filter((m) => m.is_closed).sort((a, b) => b.id - a.id);
      const all = [{ key: "none", milestone: null, tickets: none },
        ...[...open, ...closed].map((m) => ({ key: "m" + m.id, milestone: m, tickets: byMs.get(m.id) || [] }))];
      return all.filter((g) => {
        if (g.tickets.length) return true;
        // empty groups: only open milestones, and only while nothing is filtered
        return !this.hasFilters && g.milestone && !g.milestone.is_closed;
      });
    },

    totalPages() { return Math.max(1, Math.ceil(this.sorted.length / this.pageSize)); },
    pageRows() {
      const p = Math.min(this.page, this.totalPages);
      return this.sorted.slice((p - 1) * this.pageSize, p * this.pageSize);
    },
  },

  watch: {
    visible: { deep: true, handler() { this.saveCols(); } },
    filters: { deep: true, handler() { this.page = 1; this.saveState(); } },
    search() { this.page = 1; },
    sort: { deep: true, handler() { this.page = 1; this.saveState(); } },
    pageSize() { this.page = 1; this.saveState(); },
    showFilters() { this.saveState(); },
    view() { this.saveState(); },
    collapsed: { deep: true, handler() { this.saveState(); } },
  },

  methods: {
    typeMeta,
    typeLabel,
    i18nGet(key) { void this.langTick; return i18nGet(key); },   // re-render when the language changes

    // ---------- filtering ----------
    matches(t) {
      const f = this.filters;
      if (f.type && t.type !== f.type) return false;
      if (f.tag_ids.length && !(t.tags || []).some((x) => f.tag_ids.includes(x.id))) return false;
      if (f.component_ids.length && !(t.components || []).some((x) => f.component_ids.includes(x.id))) return false;
      if (f.milestone_ids.length && !f.milestone_ids.includes(t.milestone_id || 0)) return false;
      if (f.assignee_ids.length && !f.assignee_ids.includes(t.assignee ? t.assignee.id : 0)) return false;
      if (f.reporter_ids.length && !f.reporter_ids.includes(t.reporter ? t.reporter.id : 0)) return false;
      if (f.tester_ids.length && !f.tester_ids.includes(t.tester ? t.tester.id : 0)) return false;
      const q = this.search.trim().toLowerCase();
      if (q && !(t.key.toLowerCase().includes(q) || (t.title || "").toLowerCase().includes(q))) return false;
      return true;
    },

    resetFilters() {
      this.filters = blEmptyFilters();
      this.search = "";
    },

    // ---------- sorting ----------
    isSortable(key) { return BL_SORTABLE.includes(key); },

    // asc -> desc -> back to the default order
    toggleSort(key) {
      if (!this.isSortable(key)) return;
      if (this.sort.key !== key) this.sort = { key, dir: "asc" };
      else if (this.sort.dir === "asc") this.sort = { key, dir: "desc" };
      else this.sort = { ...BL_DEFAULT_SORT };
    },

    seq(t) {
      const m = /-(\d+)$/.exec(t.key || "");
      return m ? parseInt(m[1], 10) : t.id;
    },

    // value used to sort; null/undefined always go to the end
    sortValue(t, key) {
      switch (key) {
        case "type": return TICKET_TYPES.indexOf(t.type);
        case "key": return this.seq(t);
        case "title": return (t.title || "").toLowerCase();
        case "author": return t.reporter ? t.reporter.full_name.toLowerCase() : null;
        case "assignee": return t.assignee ? t.assignee.full_name.toLowerCase() : null;
        case "status": return t.column ? t.column.position : null;
        case "milestone": return t.milestone ? t.milestone.title.toLowerCase() : null;
        case "created": return new Date(t.created_at).getTime();
        default: return 0;
      }
    },

    compare(a, b, key, sign) {
      const va = this.sortValue(a, key);
      const vb = this.sortValue(b, key);
      if (va === null && vb === null) return a.id - b.id;
      if (va === null) return 1;
      if (vb === null) return -1;
      const r = typeof va === "string" ? va.localeCompare(vb) : va - vb;
      return r !== 0 ? r * sign : a.id - b.id;
    },

    // ---------- groups ----------
    isCollapsed(key) { return !!this.collapsed[key]; },
    toggleGroup(key) { this.collapsed = { ...this.collapsed, [key]: !this.collapsed[key] }; },
    groupStatus(m) {
      if (m.is_closed) return this.i18nGet("rm.status.done");
      if (m.ready_to_close) return this.i18nGet("rm.badge.ready");
      return this.i18nGet("rm.status." + m.status);
    },

    // ---------- pages ----------
    goPage(n) { this.page = Math.min(Math.max(1, n), this.totalPages); },

    // ---------- remembered settings ----------
    colsKey() { return `rt_backlog_cols_${this.projectId}`; },
    stateKey() { return `rt_backlog_state_${this.projectId}`; },

    loadCols() {
      try {
        const saved = JSON.parse(localStorage.getItem(this.colsKey()) || "null");
        if (saved && typeof saved === "object") {
          const v = blDefaults();
          for (const k of Object.keys(v)) if (typeof saved[k] === "boolean") v[k] = saved[k];
          this.visible = v;
        }
      } catch (_) { /* storage may be unavailable */ }
    },

    saveCols() {
      try { localStorage.setItem(this.colsKey(), JSON.stringify(this.visible)); } catch (_) { /* ignore */ }
    },

    loadState() {
      try {
        const saved = JSON.parse(localStorage.getItem(this.stateKey()) || "null");
        if (!saved || typeof saved !== "object") return;
        const keep = (list, ids) => (Array.isArray(list) ? list.filter((id) => id === 0 || ids.has(id)) : []);
        const users = new Set(this.memberUsers.map((u) => u.id));
        const f = saved.filters || {};
        this.filters = {
          type: TICKET_TYPES.includes(f.type) ? f.type : null,
          tag_ids: keep(f.tag_ids, new Set(this.tagOptions.map((x) => x.id))).filter((id) => id !== 0),
          component_ids: keep(f.component_ids, new Set(this.componentOptions.map((x) => x.id))).filter((id) => id !== 0),
          milestone_ids: keep(f.milestone_ids, new Set(this.milestones.map((x) => x.id))),
          assignee_ids: keep(f.assignee_ids, users),
          reporter_ids: keep(f.reporter_ids, users).filter((id) => id !== 0),
          tester_ids: keep(f.tester_ids, users),
        };
        if (saved.sort && BL_SORTABLE.includes(saved.sort.key) && ["asc", "desc"].includes(saved.sort.dir)) {
          this.sort = { key: saved.sort.key, dir: saved.sort.dir };
        }
        if (BL_PAGE_SIZES.includes(saved.pageSize)) this.pageSize = saved.pageSize;
        this.showFilters = !!saved.showFilters;
        if (saved.view === "list" || saved.view === "grouped") this.view = saved.view;
        if (saved.collapsed && typeof saved.collapsed === "object") {
          const valid = new Set(["none", ...this.milestones.map((m) => "m" + m.id)]);
          this.collapsed = Object.fromEntries(Object.entries(saved.collapsed).filter(([k, v]) => v === true && valid.has(k)));
        }
      } catch (_) { /* damaged saved data: ignore */ }
    },

    saveState() {
      if (!this.loaded) return;       // do not overwrite the saved settings while they are being restored
      try {
        localStorage.setItem(this.stateKey(), JSON.stringify({
          filters: this.filters, sort: this.sort, pageSize: this.pageSize, showFilters: this.showFilters,
          view: this.view, collapsed: this.collapsed,
        }));
      } catch (_) { /* ignore */ }
    },

    // ---------- dialogs ----------
    openTicket(t) { this.editKey = t.key; },

    openCreate(defaults = {}) {
      this.createDefaults = defaults;
      this.showCreate = true;
    },

    async reloadTickets() {
      const [tickets, tags, components, roadmap] = await Promise.all([
        API.projectTickets(this.projectId, "all"),
        API.tags(this.projectId),
        API.components(this.projectId),
        API.roadmap(this.projectId),
      ]);
      this.tickets = tickets;
      this.tagOptions = tags;
      this.componentOptions = components;
      this.milestones = roadmap.milestones;
    },

    onProfileUpdated(user) { this.me = user; },

    async load() {
      this.loading = true;
      try {
        const [me, project, tickets, stats, members, tags, components, roadmap] = await Promise.all([
          API.me(),
          API.project(this.projectId),
          API.projectTickets(this.projectId, "all"),
          API.projectStats(this.projectId),
          API.members(this.projectId),
          API.tags(this.projectId),
          API.components(this.projectId),
          API.roadmap(this.projectId),
        ]);
        this.me = me;
        this.project = project;
        this.tickets = tickets;
        this.role = stats.role;
        this.members = members;
        this.tagOptions = tags;
        this.componentOptions = components;
        this.milestones = roadmap.milestones;
      } catch (err) {
        if (err.status === 401) { location.href = "/"; return; }
        if (err.status === 403) { this.error = err.message; }
        else { this.error = `${i18nGet("dash.error.load")}: ${err.message}`; }
      } finally {
        this.loading = false;
      }
    },
  },

  async mounted() {
    document.title = i18nGet("backlog.page_title");
    if (!API.token()) { location.href = "/"; return; }

    const raw = new URLSearchParams(location.search).get("project") || "";
    this.projectId = /^\d+$/.test(raw) ? Number(raw) : NaN;   // digits only

    this.loadCols();
    await this.load();
    this.loadState();
    this.loaded = true;
    document.addEventListener("click", () => { this.showCols = false; });
    document.querySelectorAll(".lang-switch button").forEach((btn) => {
      btn.addEventListener("click", () => setTimeout(() => { this.langTick++; }, 0));
    });
  },

  updated() {
    applyI18n();
  },
});

registerSharedComponents(app);
app.component("BlTable", BlTable);
registerTicketDialogs(app);
app.mount("#app");
