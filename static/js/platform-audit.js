/* ============================================================
   Rapid Task Platform — the Audit log section (needs the "Audit log" permission)
   Newest events first. Filters: event, who did it, target. Pages of 25 / 50 / 100.
   ============================================================ */
const PlatformAudit = {
  name: "PlatformAudit",

  data() {
    return {
      items: [], total: 0, page: 1, pageSize: 50,
      filters: { action: "", actor: "", target: "" },
      actions: [],
      loading: true, loadError: "",
    };
  },

  computed: {
    pages() { return Math.max(1, Math.ceil(this.total / this.pageSize)); },
    filtered() { return !!(this.filters.action || this.filters.actor.trim() || this.filters.target.trim()); },
    summary() {
      if (!this.total) return "No events";
      const from = (this.page - 1) * this.pageSize + 1;
      const to = Math.min(this.total, this.page * this.pageSize);
      return `${from}–${to} of ${this.total} events`;
    },
  },

  methods: {
    fmt: PlatformUI.fmt,
    label: (action) => PlatformUI.auditLabel(action),
    tone: (action) => PlatformUI.auditTone(action),
    describe: (entry) => PlatformUI.auditDetails(entry),

    async load(silent) {
      const ticket = (this._ticket = (this._ticket || 0) + 1);        // a slow old answer must not replace a newer one
      if (!silent) this.loading = true;
      this.loadError = "";
      try {
        const data = await PlatformAPI.audit({
          page: this.page, page_size: this.pageSize,
          action: this.filters.action, actor: this.filters.actor.trim(), target: this.filters.target.trim(),
        });
        if (ticket !== this._ticket) return;
        this.items = data.items;
        this.total = data.total;
        if (!data.items.length && data.total > 0 && this.page > 1) {   // the log got shorter: go to the last page
          this.page = this.pages;
          return this.load(true);
        }
      } catch (err) {
        if (ticket !== this._ticket) return;
        if (err.status !== 401) this.loadError = err.message;
      } finally {
        if (ticket === this._ticket) this.loading = false;
      }
    },

    async loadActions() {
      try { this.actions = await PlatformAPI.auditActions(); } catch (_) { /* the dropdown keeps "All events" */ }
    },

    refresh() { this.loadActions(); this.load(true); },
    first() { this.page = 1; this.load(true); },
    typed() {                                         // text filters wait a moment for the next key
      clearTimeout(this._typing);
      this._typing = setTimeout(() => this.first(), 350);
    },
    clearFilters() {
      clearTimeout(this._typing);
      this.filters = { action: "", actor: "", target: "" };
      this.first();
    },
    go(page) {
      if (page < 1 || page > this.pages || page === this.page) return;
      this.page = page;
      this.load(true);
    },
    sizeChanged() { this.first(); },
  },

  mounted() { this.loadActions(); this.load(); },
  beforeUnmount() { clearTimeout(this._typing); this._ticket = -1; },

  template: `
  <section data-testid="audit-page">
    <form class="pl-card pl-filters" data-testid="audit-filters" @submit.prevent="first">
      <div class="field">
        <label for="pl-audit-action">Event</label>
        <select id="pl-audit-action" class="input" v-model="filters.action" data-testid="audit-action" @change="first">
          <option value="">All events</option>
          <option v-for="a in actions" :key="a" :value="a">{{ label(a) }}</option>
        </select>
      </div>
      <div class="field">
        <label for="pl-audit-actor">Done by</label>
        <input id="pl-audit-actor" class="input" v-model="filters.actor" placeholder="username" autocomplete="off"
               maxlength="60" data-testid="audit-actor" @input="typed">
      </div>
      <div class="field">
        <label for="pl-audit-target">Target</label>
        <input id="pl-audit-target" class="input" v-model="filters.target" placeholder="username" autocomplete="off"
               maxlength="100" data-testid="audit-target" @input="typed">
      </div>
      <div class="pl-filter-buttons">
        <button type="button" class="btn btn-ghost btn-sm" data-testid="audit-clear" :disabled="!filtered" @click="clearFilters">Clear</button>
        <button type="button" class="btn btn-ghost btn-sm" data-testid="audit-refresh" @click="refresh">Refresh</button>
      </div>
    </form>

    <article class="pl-card pl-table-card">
      <p class="pl-muted pl-pad" v-if="loading" data-testid="audit-loading">Loading…</p>
      <div class="pl-pad" v-else-if="loadError">
        <p class="form-error" role="alert" data-testid="audit-error">{{ loadError }}</p>
        <button type="button" class="btn btn-ghost btn-sm" data-testid="audit-retry" @click="load()">Try again</button>
      </div>
      <template v-else>
        <div class="pl-table-wrap" v-if="items.length">
          <table class="pl-table" data-testid="audit-table">
            <thead><tr><th>Time</th><th>Done by</th><th>Event</th><th>Target</th><th>Details</th><th>IP</th></tr></thead>
            <tbody>
              <tr v-for="e in items" :key="e.id" data-testid="audit-row" :data-action="e.action">
                <td class="pl-nowrap" data-testid="audit-time">{{ fmt(e.created_at) }}</td>
                <td data-testid="audit-actor-cell">{{ e.actor_name || "—" }}</td>
                <td><span class="pl-pill" :class="tone(e.action)" data-testid="audit-action-pill">{{ label(e.action) }}</span></td>
                <td data-testid="audit-target-cell">{{ e.target_name || "—" }}</td>
                <td class="pl-details" data-testid="audit-details">{{ describe(e) }}</td>
                <td class="pl-nowrap" data-testid="audit-ip">{{ e.ip || "—" }}</td>
              </tr>
            </tbody>
          </table>
        </div>
        <p class="pl-muted pl-pad" v-else data-testid="audit-empty">{{ filtered ? "No events match these filters." : "No events yet." }}</p>

        <div class="pl-pager" data-testid="audit-pager">
          <span class="pl-muted" data-testid="audit-summary">{{ summary }}</span>
          <span class="pl-pager-controls">
            <label class="pl-muted" for="pl-audit-size">Per page</label>
            <select id="pl-audit-size" class="input pl-size" v-model.number="pageSize" data-testid="audit-page-size" @change="sizeChanged">
              <option :value="25">25</option><option :value="50">50</option><option :value="100">100</option>
            </select>
            <button type="button" class="btn btn-ghost btn-sm" data-testid="audit-prev" :disabled="page <= 1" @click="go(page - 1)">‹ Previous</button>
            <span class="pl-muted" data-testid="audit-page-info">Page {{ page }} of {{ pages }}</span>
            <button type="button" class="btn btn-ghost btn-sm" data-testid="audit-next" :disabled="page >= pages" @click="go(page + 1)">Next ›</button>
          </span>
        </div>
      </template>
    </article>
  </section>`,
};
