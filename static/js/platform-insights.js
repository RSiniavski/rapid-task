/* ============================================================
   Rapid Task Platform — the Project Insights section (needs the "Analytics" permission to look)
   The projects of the Rapid Task app: search, status tabs, warnings (inactive, empty), sort, pages.
   Only the root admin sees the buttons: Suspend / Unsuspend, Archive / Restore, Delete.
     Suspend = the members can not open the project and read the reason (the reason is required)
     Archive = the project is hidden from its members | Delete = everything is removed for good
   ============================================================ */
const PlatformInsights = {
  name: "PlatformInsights",
  props: { me: { type: Object, default: () => ({}) } },
  emits: ["notify"],

  data() {
    return {
      items: [], total: 0, page: 1, pageSize: 25,
      counts: { all: 0, active: 0, archived: 0, suspended: 0 },
      flags: { inactive: 0, empty: 0 },
      filters: { q: "", status: "", flag: "", sort: "created" },
      tabs: [
        { key: "", id: "all", label: "All" },
        { key: "active", id: "active", label: "Active" },
        { key: "archived", id: "archived", label: "Archived" },
        { key: "suspended", id: "suspended", label: "Suspended" },
      ],
      loading: true, loadError: "",
      busyId: null,                       // the row whose request is running
      modal: null,                        // { kind: "suspend" | "archive" | "delete", project }
      reason: "", typedKey: "",
      formBusy: false, formError: "",
    };
  },

  computed: {
    isRoot() { return !!(this.me && this.me.is_root); },
    pages() { return Math.max(1, Math.ceil(this.total / this.pageSize)); },
    filtered() { return !!(this.filters.q.trim() || this.filters.status || this.filters.flag); },
    summary() {
      if (!this.total) return "No projects";
      const from = (this.page - 1) * this.pageSize + 1;
      const to = Math.min(this.total, this.page * this.pageSize);
      return `${from}–${to} of ${this.total} projects`;
    },
    canConfirm() {
      const m = this.modal;
      if (!m) return false;
      if (m.kind === "suspend") return !!this.reason.trim();
      if (m.kind === "delete") return this.typedKey.trim().toUpperCase() === m.project.key.toUpperCase();
      return true;
    },
  },

  methods: {
    fmt: PlatformUI.fmt,
    fmtDate: PlatformUI.fmtDate,
    notify(message, kind) { this.$emit("notify", message, kind || "ok"); },
    tone: (status) => ({ active: "ok", archived: "", suspended: "bad" }[status] || ""),
    statusLabel: (status) => ({ active: "Active", archived: "Archived", suspended: "Suspended" }[status] || status),
    countOf(tab) { return this.counts[tab.id] || 0; },

    async load(silent) {
      const ticket = (this._ticket = (this._ticket || 0) + 1);        // a slow old answer must not replace a newer one
      if (!silent) this.loading = true;
      this.loadError = "";
      try {
        const data = await PlatformAPI.insights({
          q: this.filters.q.trim(), status: this.filters.status, flag: this.filters.flag, sort: this.filters.sort,
          page: this.page, page_size: this.pageSize,
        });
        if (ticket !== this._ticket) return;
        this.items = data.items;
        this.total = data.total;
        this.counts = data.counts;
        this.flags = data.flags;
        if (!data.items.length && data.total > 0 && this.page > 1) {   // the list got shorter: go to the last page
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

    first() { this.page = 1; this.load(true); },
    typed() {                                         // the search waits a moment for the next key
      clearTimeout(this._typing);
      this._typing = setTimeout(() => this.first(), 350);
    },
    setStatus(key) { this.filters.status = key; this.first(); },
    setFlag(key) { this.filters.flag = this.filters.flag === key ? "" : key; this.first(); },
    clearFilters() {
      clearTimeout(this._typing);
      this.filters.q = ""; this.filters.status = ""; this.filters.flag = "";
      this.first();
    },
    go(page) {
      if (page < 1 || page > this.pages || page === this.page) return;
      this.page = page;
      this.load(true);
    },

    /* ---- actions without a question: restore, unsuspend ---- */
    async quick(p, action) {
      if (this.busyId !== null) return;
      this.busyId = p.id;
      try {
        await PlatformAPI.insightAction(p.id, action);
        this.notify(action === "restore" ? `${p.name} is restored.` : `${p.name} is active again.`);
      } catch (err) {
        if (err.status === 401) return;
        this.notify(err.message, "error");
      } finally {
        this.busyId = null;
      }
      this.load(true);
    },

    /* ---- actions with a question: suspend, archive, delete ---- */
    ask(kind, p) {
      this.formError = ""; this.formBusy = false; this.reason = ""; this.typedKey = "";
      this.modal = { kind, project: p };
      this.$nextTick(() => {
        const el = kind === "delete" ? this.$refs.typed : (this.$refs.reasonBox || this.$refs.cancel);
        if (el && el.focus) el.focus();
      });
    },
    closeModal() { if (!this.formBusy) this.modal = null; },
    onKey(e) { if (e.key === "Escape" && this.modal) this.closeModal(); },
    async confirm() {
      const m = this.modal;
      if (!m || this.formBusy || !this.canConfirm) return;
      this.formBusy = true; this.formError = "";
      try {
        if (m.kind === "delete") await PlatformAPI.deleteProject(m.project.id);
        else if (m.kind === "suspend") await PlatformAPI.insightAction(m.project.id, "suspend", { reason: this.reason.trim() });
        else await PlatformAPI.insightAction(m.project.id, "archive", this.reason.trim() ? { reason: this.reason.trim() } : {});
        this.notify(m.kind === "delete" ? `${m.project.name} is deleted.`
          : m.kind === "suspend" ? `${m.project.name} is suspended.` : `${m.project.name} is archived.`);
        this.formBusy = false;
        this.modal = null;
        this.load(true);
      } catch (err) {
        this.formBusy = false;
        if (err.status === 401) return;
        this.formError = err.message;
        if (err.status === 404 || err.status === 409) this.load(true);
      }
    },
  },

  mounted() {
    document.addEventListener("keydown", this.onKey);
    this.load();
  },
  beforeUnmount() {
    document.removeEventListener("keydown", this.onKey);
    clearTimeout(this._typing);
    this._ticket = -1;
  },

  template: `
  <section data-testid="insights-page">
    <form class="pl-card pl-filters" data-testid="insights-filters" @submit.prevent="first">
      <div class="field pl-grow">
        <label for="pl-ins-q">Search</label>
        <input id="pl-ins-q" class="input" v-model="filters.q" placeholder="project name, key or owner" autocomplete="off"
               maxlength="100" data-testid="insights-search" @input="typed">
      </div>
      <div class="field">
        <label for="pl-ins-sort">Sort by</label>
        <select id="pl-ins-sort" class="input" v-model="filters.sort" data-testid="insights-sort" @change="first">
          <option value="created">Newest first</option>
          <option value="name">Name (A–Z)</option>
          <option value="tickets">Most tickets</option>
          <option value="members">Most members</option>
          <option value="activity">Last activity</option>
        </select>
      </div>
      <div class="pl-filter-buttons">
        <button type="button" class="btn btn-ghost btn-sm" data-testid="insights-clear" :disabled="!filtered" @click="clearFilters">Clear</button>
        <button type="button" class="btn btn-ghost btn-sm" data-testid="insights-refresh" @click="load(true)">Refresh</button>
      </div>
    </form>

    <div class="pl-tabs" role="tablist" aria-label="Status" data-testid="insights-tabs">
      <button v-for="t in tabs" :key="t.id" type="button" role="tab" class="pl-tab" :class="{ on: filters.status === t.key }"
              :aria-selected="filters.status === t.key ? 'true' : 'false'" :data-testid="'insights-tab-' + t.id" @click="setStatus(t.key)">
        {{ t.label }} <b class="pl-tab-count" :data-testid="'insights-count-' + t.id">{{ countOf(t) }}</b>
      </button>
      <span class="pl-tabs-gap" aria-hidden="true"></span>
      <button type="button" class="pl-tab" :class="{ on: filters.flag === 'inactive' }" :aria-pressed="filters.flag === 'inactive' ? 'true' : 'false'"
              title="Active projects with no activity for 30 days" data-testid="insights-flag-inactive" @click="setFlag('inactive')">
        Inactive <b class="pl-tab-count" data-testid="insights-flagcount-inactive">{{ flags.inactive }}</b>
      </button>
      <button type="button" class="pl-tab" :class="{ on: filters.flag === 'empty' }" :aria-pressed="filters.flag === 'empty' ? 'true' : 'false'"
              title="Active projects with no tickets or only one member" data-testid="insights-flag-empty" @click="setFlag('empty')">
        Empty <b class="pl-tab-count" data-testid="insights-flagcount-empty">{{ flags.empty }}</b>
      </button>
    </div>

    <p class="pl-muted pl-note" v-if="!isRoot" data-testid="insights-readonly">You can look at the projects. Only the root admin can suspend, archive or delete them.</p>

    <article class="pl-card pl-table-card">
      <p class="pl-muted pl-pad" v-if="loading" data-testid="insights-loading">Loading…</p>
      <div class="pl-pad" v-else-if="loadError">
        <p class="form-error" role="alert" data-testid="insights-error">{{ loadError }}</p>
        <button type="button" class="btn btn-ghost btn-sm" data-testid="insights-retry" @click="load()">Try again</button>
      </div>
      <template v-else>
        <div class="pl-table-wrap" v-if="items.length">
          <table class="pl-table" data-testid="insights-table">
            <thead>
              <tr>
                <th>Project</th><th>Owner</th><th>Status</th>
                <th class="pl-num" title="People in the project">Members</th>
                <th class="pl-num">Tickets</th>
                <th class="pl-num" title="Tickets that are not done">Open</th>
                <th>Last activity</th><th>Warnings</th>
                <th class="pl-th-actions" v-if="isRoot">Actions</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="p in items" :key="p.id" data-testid="project-row" :data-id="p.id" :data-status="p.status"
                  :class="{ 'is-blocked': p.status !== 'active' }">
                <td>
                  <span class="pl-person-text">
                    <strong data-testid="project-name" :title="'Created ' + fmtDate(p.created_at)">{{ p.name }}</strong>
                    <small data-testid="project-key">{{ p.key }}</small>
                  </span>
                </td>
                <td>
                  <span class="pl-person-text">
                    <strong data-testid="project-owner">{{ p.owner_name }}</strong>
                    <small data-testid="project-owner-email">{{ p.owner_email }}</small>
                  </span>
                </td>
                <td>
                  <span class="pl-pill" :class="tone(p.status)" data-testid="project-status">{{ statusLabel(p.status) }}</span>
                  <small class="pl-reason" v-if="p.status_reason" data-testid="project-reason" :title="p.status_reason">{{ p.status_reason }}</small>
                </td>
                <td class="pl-num" data-testid="project-members">{{ p.members_count }}</td>
                <td class="pl-num" data-testid="project-tickets">{{ p.tickets_total }}</td>
                <td class="pl-num" data-testid="project-open">{{ p.tickets_open }}</td>
                <td class="pl-nowrap" data-testid="project-activity">{{ fmt(p.last_activity_at) }}</td>
                <td>
                  <span class="pl-flags">
                    <span class="pl-pill warn" v-if="p.inactive" data-testid="project-flag-inactive">Inactive</span>
                    <span class="pl-pill warn" v-if="p.empty" data-testid="project-flag-empty">Empty</span>
                    <span class="pl-muted" v-if="!p.inactive && !p.empty">—</span>
                  </span>
                </td>
                <td v-if="isRoot">
                  <div class="pl-actions">
                    <button v-if="p.status === 'active'" type="button" class="btn btn-ghost pl-act" data-testid="project-suspend"
                            :disabled="busyId !== null" :aria-label="'Suspend ' + p.name" @click="ask('suspend', p)">Suspend</button>
                    <button v-if="p.status === 'active'" type="button" class="btn btn-ghost pl-act" data-testid="project-archive"
                            :disabled="busyId !== null" :aria-label="'Archive ' + p.name" @click="ask('archive', p)">Archive</button>
                    <button v-if="p.status === 'suspended'" type="button" class="btn btn-ghost pl-act" data-testid="project-unsuspend"
                            :disabled="busyId !== null" :aria-label="'Unsuspend ' + p.name" @click="quick(p, 'unsuspend')">Unsuspend</button>
                    <button v-if="p.status === 'archived'" type="button" class="btn btn-ghost pl-act" data-testid="project-restore"
                            :disabled="busyId !== null" :aria-label="'Restore ' + p.name" @click="quick(p, 'restore')">Restore</button>
                    <button type="button" class="btn btn-danger pl-act" data-testid="project-delete" :disabled="busyId !== null"
                            :aria-label="'Delete ' + p.name" @click="ask('delete', p)">Delete</button>
                  </div>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
        <p class="pl-muted pl-pad" v-else data-testid="insights-empty">{{ filtered ? "No projects match these filters." : "No projects yet." }}</p>

        <div class="pl-pager" data-testid="insights-pager">
          <span class="pl-muted" data-testid="insights-summary">{{ summary }}</span>
          <span class="pl-pager-controls">
            <label class="pl-muted" for="pl-ins-size">Per page</label>
            <select id="pl-ins-size" class="input pl-size" v-model.number="pageSize" data-testid="insights-page-size" @change="first">
              <option :value="25">25</option><option :value="50">50</option><option :value="100">100</option>
            </select>
            <button type="button" class="btn btn-ghost btn-sm" data-testid="insights-prev" :disabled="page <= 1" @click="go(page - 1)">‹ Previous</button>
            <span class="pl-muted" data-testid="insights-page-info">Page {{ page }} of {{ pages }}</span>
            <button type="button" class="btn btn-ghost btn-sm" data-testid="insights-next" :disabled="page >= pages" @click="go(page + 1)">Next ›</button>
          </span>
        </div>
      </template>
    </article>

    <div class="modal-backdrop open" v-if="modal" data-testid="project-modal-backdrop" @mousedown.self="closeModal">
      <form class="modal pl-modal" role="dialog" aria-modal="true" :aria-label="modal.kind + ' project'" data-testid="project-modal"
            @submit.prevent="confirm" novalidate>
        <button type="button" class="modal-close" aria-label="Close" data-testid="project-modal-close" @click="closeModal">×</button>

        <template v-if="modal.kind === 'suspend'">
          <h2 class="pl-modal-title">Suspend project</h2>
          <p class="pl-modal-text">Suspend <strong data-testid="project-target">{{ modal.project.name }}</strong> ({{ modal.project.key }})?</p>
          <ul class="pl-modal-list">
            <li>The {{ modal.project.members_count }} member(s) can not open the project. All the data stays.</li>
            <li>The members <strong>read the reason</strong>, so write it for them.</li>
            <li>The project stays suspended until you unsuspend it.</li>
          </ul>
          <div class="field">
            <label for="pl-ins-reason">Reason (required)</label>
            <textarea id="pl-ins-reason" class="input" rows="3" maxlength="500" v-model="reason" ref="reasonBox" data-testid="project-modal-reason"></textarea>
          </div>
        </template>

        <template v-else-if="modal.kind === 'archive'">
          <h2 class="pl-modal-title">Archive project</h2>
          <p class="pl-modal-text">Archive <strong data-testid="project-target">{{ modal.project.name }}</strong> ({{ modal.project.key }})?</p>
          <ul class="pl-modal-list">
            <li>The project is hidden from its members (it looks like it does not exist). All the data stays.</li>
            <li>You can restore it at any time.</li>
          </ul>
          <div class="field">
            <label for="pl-ins-reason">Note for the audit log (optional)</label>
            <textarea id="pl-ins-reason" class="input" rows="2" maxlength="500" v-model="reason" ref="reasonBox" data-testid="project-modal-reason"></textarea>
          </div>
        </template>

        <template v-else>
          <h2 class="pl-modal-title">Delete project</h2>
          <p class="pl-modal-text">Delete <strong data-testid="project-target">{{ modal.project.name }}</strong> ({{ modal.project.key }})?</p>
          <ul class="pl-modal-list">
            <li>{{ modal.project.tickets_total }} ticket(s), their comments, history and files are removed for good.</li>
            <li><strong>This can not be undone.</strong></li>
          </ul>
          <div class="field">
            <label for="pl-ins-key">Type the project key <b>{{ modal.project.key }}</b> to confirm</label>
            <input id="pl-ins-key" class="input" v-model="typedKey" ref="typed" autocomplete="off" data-testid="project-modal-key">
          </div>
        </template>

        <div class="form-error" role="alert" data-testid="project-modal-error">{{ formError }}</div>
        <div class="pl-modal-actions">
          <button type="button" class="btn btn-ghost" data-testid="project-modal-cancel" ref="cancel" :disabled="formBusy" @click="closeModal">Cancel</button>
          <button type="submit" class="btn" :class="modal.kind === 'archive' ? 'btn-primary' : 'btn-danger'" data-testid="project-modal-confirm"
                  :disabled="formBusy || !canConfirm">
            {{ formBusy ? "Working…" : (modal.kind === "suspend" ? "Suspend" : modal.kind === "archive" ? "Archive" : "Delete") }}
          </button>
        </div>
      </form>
    </div>
  </section>`,
};
