/* ============================================================
   Rapid Task Platform — the Users section (needs the "Manage users" permission)
   The people of the Rapid Task app: search, status filter, counters, block / unblock, soft delete.
   Delete asks first. A deleted user keeps the name and all the work; the e-mail is freed.
   ============================================================ */
const PlatformUsers = {
  name: "PlatformUsers",
  emits: ["notify"],

  data() {
    return {
      items: [], total: 0, page: 1, pageSize: 25,
      counts: { all: 0, active: 0, blocked: 0, deactivated: 0, deleted: 0 },
      filters: { q: "", status: "", sort: "created" },
      tabs: [
        { key: "", id: "all", label: "All" },
        { key: "active", id: "active", label: "Active" },
        { key: "blocked", id: "blocked", label: "Blocked" },
        { key: "deactivated", id: "deactivated", label: "Deactivated" },
        { key: "deleted", id: "deleted", label: "Deleted" },
      ],
      loading: true, loadError: "",
      busyId: null,                       // the row whose request is running
      modal: null,                        // { user } for the delete question
      formBusy: false, formError: "",
    };
  },

  computed: {
    pages() { return Math.max(1, Math.ceil(this.total / this.pageSize)); },
    filtered() { return !!(this.filters.q.trim() || this.filters.status); },
    summary() {
      if (!this.total) return "No users";
      const from = (this.page - 1) * this.pageSize + 1;
      const to = Math.min(this.total, this.page * this.pageSize);
      return `${from}–${to} of ${this.total} users`;
    },
  },

  methods: {
    fmt: PlatformUI.fmt,
    fmtDate: PlatformUI.fmtDate,
    initials: PlatformUI.initials,
    notify(message, kind) { this.$emit("notify", message, kind || "ok"); },
    tone: (status) => ({ active: "ok", blocked: "bad", deactivated: "warn", deleted: "" }[status] || ""),
    statusLabel: (status) => ({ active: "Active", blocked: "Blocked", deactivated: "Deactivated", deleted: "Deleted" }[status] || status),
    avatarOf: (u) => (u.avatar_url && String(u.avatar_url).startsWith("/uploads/") ? u.avatar_url : ""),
    countOf(tab) { return this.counts[tab.id] || 0; },

    async load(silent) {
      const ticket = (this._ticket = (this._ticket || 0) + 1);        // a slow old answer must not replace a newer one
      if (!silent) this.loading = true;
      this.loadError = "";
      try {
        const data = await PlatformAPI.users({
          q: this.filters.q.trim(), status: this.filters.status, sort: this.filters.sort,
          page: this.page, page_size: this.pageSize,
        });
        if (ticket !== this._ticket) return;
        this.items = data.items;
        this.total = data.total;
        this.counts = data.counts;
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
    clearFilters() {
      clearTimeout(this._typing);
      this.filters.q = ""; this.filters.status = "";
      this.first();
    },
    go(page) {
      if (page < 1 || page > this.pages || page === this.page) return;
      this.page = page;
      this.load(true);
    },

    async toggle(u) {
      if (this.busyId !== null) return;
      this.busyId = u.id;
      const blocking = u.status === "active";
      try {
        if (blocking) await PlatformAPI.blockUser(u.id); else await PlatformAPI.unblockUser(u.id);
        this.notify(blocking ? `${u.full_name} is blocked.` : `${u.full_name} can log in again.`);
      } catch (err) {
        if (err.status === 401) return;
        this.notify(err.message, "error");
      } finally {
        this.busyId = null;
      }
      this.load(true);                                // the row may move to another status tab: ask the server again
    },

    askDelete(u) {
      this.formError = ""; this.formBusy = false;
      this.modal = { user: u };
      this.$nextTick(() => { const el = this.$refs.cancel; if (el && el.focus) el.focus(); });
    },
    closeModal() { if (!this.formBusy) this.modal = null; },
    onKey(e) { if (e.key === "Escape" && this.modal) this.closeModal(); },
    async confirmDelete() {
      const m = this.modal;
      if (!m || this.formBusy) return;
      this.formBusy = true; this.formError = "";
      try {
        await PlatformAPI.deleteUser(m.user.id);
        this.notify(`${m.user.full_name} is deleted.`);
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
  <section data-testid="users-page">
    <form class="pl-card pl-filters" data-testid="users-filters" @submit.prevent="first">
      <div class="field pl-grow">
        <label for="pl-users-q">Search</label>
        <input id="pl-users-q" class="input" v-model="filters.q" placeholder="name or e-mail" autocomplete="off"
               maxlength="100" data-testid="users-search" @input="typed">
      </div>
      <div class="field">
        <label for="pl-users-sort">Sort by</label>
        <select id="pl-users-sort" class="input" v-model="filters.sort" data-testid="users-sort" @change="first">
          <option value="created">Newest first</option>
          <option value="name">Name (A–Z)</option>
          <option value="last_login">Last login</option>
        </select>
      </div>
      <div class="pl-filter-buttons">
        <button type="button" class="btn btn-ghost btn-sm" data-testid="users-clear" :disabled="!filtered" @click="clearFilters">Clear</button>
        <button type="button" class="btn btn-ghost btn-sm" data-testid="users-refresh" @click="load(true)">Refresh</button>
      </div>
    </form>

    <div class="pl-tabs" role="tablist" aria-label="Status" data-testid="users-tabs">
      <button v-for="t in tabs" :key="t.id" type="button" role="tab" class="pl-tab" :class="{ on: filters.status === t.key }"
              :aria-selected="filters.status === t.key ? 'true' : 'false'" :data-testid="'users-tab-' + t.id" @click="setStatus(t.key)">
        {{ t.label }} <b class="pl-tab-count" :data-testid="'users-count-' + t.id">{{ countOf(t) }}</b>
      </button>
    </div>

    <article class="pl-card pl-table-card">
      <p class="pl-muted pl-pad" v-if="loading" data-testid="users-loading">Loading…</p>
      <div class="pl-pad" v-else-if="loadError">
        <p class="form-error" role="alert" data-testid="users-error">{{ loadError }}</p>
        <button type="button" class="btn btn-ghost btn-sm" data-testid="users-retry" @click="load()">Try again</button>
      </div>
      <template v-else>
        <div class="pl-table-wrap" v-if="items.length">
          <table class="pl-table" data-testid="users-table">
            <thead>
              <tr>
                <th>User</th><th>Status</th>
                <th class="pl-num" title="Projects where the user is a member">Projects</th>
                <th class="pl-num" title="Assigned tickets that are not done">Open</th>
                <th class="pl-num" title="Tickets created by the user">Reported</th>
                <th>Created</th><th>Last login</th><th class="pl-th-actions">Actions</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="u in items" :key="u.id" data-testid="user-row" :data-id="u.id" :data-status="u.status"
                  :class="{ 'is-blocked': u.status !== 'active' }">
                <td>
                  <div class="pl-person">
                    <img v-if="avatarOf(u)" class="pl-avatar pl-avatar-img" :src="avatarOf(u)" alt="">
                    <span v-else class="pl-avatar" aria-hidden="true">{{ initials(u.full_name) }}</span>
                    <span class="pl-person-text">
                      <strong data-testid="user-name">{{ u.full_name }}</strong>
                      <small data-testid="user-email">{{ u.email }}</small>
                    </span>
                  </div>
                </td>
                <td><span class="pl-pill" :class="tone(u.status)" data-testid="user-status">{{ statusLabel(u.status) }}</span></td>
                <td class="pl-num" data-testid="user-projects">{{ u.projects_count }}</td>
                <td class="pl-num" data-testid="user-open">{{ u.assigned_open_count }}</td>
                <td class="pl-num" data-testid="user-reported">{{ u.reported_count }}</td>
                <td class="pl-nowrap" data-testid="user-created">{{ fmtDate(u.created_at) }}</td>
                <td class="pl-nowrap" data-testid="user-last-login">{{ fmt(u.last_login_at) }}</td>
                <td>
                  <div class="pl-actions" v-if="u.status !== 'deleted'">
                    <button v-if="u.status === 'active'" type="button" class="btn btn-ghost pl-act" data-testid="user-block"
                            :disabled="busyId !== null" :aria-label="'Block ' + u.full_name" @click="toggle(u)">Block</button>
                    <button v-if="u.status === 'blocked'" type="button" class="btn btn-ghost pl-act" data-testid="user-unblock"
                            :disabled="busyId !== null" :aria-label="'Unblock ' + u.full_name" @click="toggle(u)">Unblock</button>
                    <button type="button" class="btn btn-danger pl-act" data-testid="user-delete" :aria-label="'Delete ' + u.full_name"
                            @click="askDelete(u)">Delete</button>
                  </div>
                  <span v-else class="pl-muted" data-testid="user-no-actions">—</span>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
        <p class="pl-muted pl-pad" v-else data-testid="users-empty">{{ filtered ? "No users match these filters." : "No users yet." }}</p>

        <div class="pl-pager" data-testid="users-pager">
          <span class="pl-muted" data-testid="users-summary">{{ summary }}</span>
          <span class="pl-pager-controls">
            <label class="pl-muted" for="pl-users-size">Per page</label>
            <select id="pl-users-size" class="input pl-size" v-model.number="pageSize" data-testid="users-page-size" @change="first">
              <option :value="25">25</option><option :value="50">50</option><option :value="100">100</option>
            </select>
            <button type="button" class="btn btn-ghost btn-sm" data-testid="users-prev" :disabled="page <= 1" @click="go(page - 1)">‹ Previous</button>
            <span class="pl-muted" data-testid="users-page-info">Page {{ page }} of {{ pages }}</span>
            <button type="button" class="btn btn-ghost btn-sm" data-testid="users-next" :disabled="page >= pages" @click="go(page + 1)">Next ›</button>
          </span>
        </div>
      </template>
    </article>

    <div class="modal-backdrop open" v-if="modal" data-testid="user-modal-backdrop" @mousedown.self="closeModal">
      <form class="modal pl-modal" role="dialog" aria-modal="true" aria-label="Delete user" data-testid="user-modal"
            @submit.prevent="confirmDelete" novalidate>
        <button type="button" class="modal-close" aria-label="Close" data-testid="user-modal-close" @click="closeModal">×</button>
        <h2 class="pl-modal-title">Delete user</h2>
        <p class="pl-modal-text">Delete <strong data-testid="user-target">{{ modal.user.full_name }}</strong> ({{ modal.user.email }})?</p>
        <ul class="pl-modal-list">
          <li>The account stops working at once.</li>
          <li>The name, tickets, comments and history stay.</li>
          <li>The e-mail is freed, so it can be registered again.</li>
          <li><strong>This can not be undone.</strong></li>
        </ul>
        <div class="form-error" role="alert" data-testid="user-modal-error">{{ formError }}</div>
        <div class="pl-modal-actions">
          <button type="button" class="btn btn-ghost" data-testid="user-delete-cancel" ref="cancel" :disabled="formBusy" @click="closeModal">Cancel</button>
          <button type="submit" class="btn btn-danger" data-testid="user-delete-confirm" :disabled="formBusy">{{ formBusy ? "Deleting…" : "Delete" }}</button>
        </div>
      </form>
    </div>
  </section>`,
};
