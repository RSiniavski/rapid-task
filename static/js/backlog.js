/* ============================================================
   Rapid Task — Backlog: table of ALL tickets of a project
   (including tickets without a milestone and tickets of closed milestones).
   Columns can be switched on/off; the choice is remembered per project.
   Click on a row opens the ticket dialog on the board.
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

function blDefaults() {
  const v = {};
  BL_COLUMNS.forEach((c) => { v[c.key] = c.on; });
  return v;
}

const app = createApp({
  data() {
    return {
      me: null,
      role: null,
      project: null,
      projectId: NaN,
      tickets: [],
      loading: true,
      error: "",
      showProfile: false,
      showCols: false,
      langTick: 0,
      // shared ticket dialogs
      showCreate: false,
      createDefaults: {},
      editKey: null,
      allColumns: BL_COLUMNS,
      visible: blDefaults(),
    };
  },

  computed: {
    shownColumns() { return BL_COLUMNS.filter((c) => this.visible[c.key]); },
    visibleCount() { return this.shownColumns.length; },
  },

  watch: {
    visible: {
      deep: true,
      handler() { this.saveCols(); },
    },
  },

  methods: {
    typeMeta,
    i18nGet(key) { void this.langTick; return i18nGet(key); },   // re-render when the language changes

    fmtDate(value) {
      if (!value) return "";
      const d = new Date(value);
      return isNaN(d) ? "" : d.toLocaleDateString();
    },

    colsKey() { return `rt_backlog_cols_${this.projectId}`; },

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

    openTicket(t) { this.editKey = t.key; },

    openCreate(defaults = {}) {
      this.createDefaults = defaults;
      this.showCreate = true;
    },

    async reloadTickets() {
      this.tickets = await API.projectTickets(this.projectId, "all");
    },

    onProfileUpdated(user) { this.me = user; },

    async load() {
      this.loading = true;
      try {
        const [me, project, tickets, stats] = await Promise.all([
          API.me(),
          API.project(this.projectId),
          API.projectTickets(this.projectId, "all"),
          API.projectStats(this.projectId),
        ]);
        this.me = me;
        this.project = project;
        this.tickets = tickets;
        this.role = stats.role;
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
    document.querySelectorAll(".lang-switch button").forEach((btn) => {
      btn.addEventListener("click", () => setTimeout(() => { this.langTick++; }, 0));
    });
    document.addEventListener("click", () => { this.showCols = false; });
  },

  updated() {
    applyI18n();
  },
});

registerSharedComponents(app);
registerTicketDialogs(app);
app.mount("#app");