/* ============================================================
   Rapid Task Platform — the System health section (needs the "System health" permission)
   Read-only: server, databases, disk, counts, load and the latest server errors.
   Refreshes by itself every 30 seconds (can be switched off; the choice is remembered).
   ============================================================ */
const PlatformHealth = {
  name: "PlatformHealth",

  data() {
    let auto = true;
    try { auto = localStorage.getItem("rt_platform_health_auto") !== "0"; } catch (_) { /* private mode */ }
    return { h: null, loading: true, loadError: "", auto, updatedAt: null };
  },

  computed: {
    layoutCustom() { return PlLayout.isCustom("health"); },
    bannerTone() { return this.tone(this.h ? this.h.status : "ok"); },
    bannerText() {
      const s = this.h ? this.h.status : "ok";
      return { ok: "All systems normal", warning: "Needs attention", critical: "There is a problem" }[s];
    },
    barWidth() { return Math.max(0, Math.min(100, this.h ? this.h.disk.used_percent : 0)); },
    updatedText() {
      if (!this.updatedAt) return "";
      const d = this.updatedAt;
      const p = (n) => String(n).padStart(2, "0");
      return `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
    },
  },

  methods: {
    resetLayout() { PlLayout.reset("health"); },
    fmt: PlatformUI.fmt,
    tone: (level) => ({ ok: "ok", warning: "warn", critical: "bad" }[level] || ""),
    levelLabel: (level) => ({ ok: "OK", warning: "Warning", critical: "Critical" }[level] || level),
    n: (v) => Number(v || 0).toLocaleString("en-GB"),
    bytes(v) {
      let x = Number(v || 0);
      const units = ["B", "KB", "MB", "GB", "TB"];
      let i = 0;
      while (x >= 1024 && i < units.length - 1) { x /= 1024; i++; }
      return (i === 0 ? String(x) : x.toFixed(1)) + " " + units[i];
    },
    uptime(sec) {
      sec = Math.max(0, Math.floor(sec || 0));
      const d = Math.floor(sec / 86400), h = Math.floor((sec % 86400) / 3600), m = Math.floor((sec % 3600) / 60);
      if (d) return `${d} d ${h} h`;
      if (h) return `${h} h ${m} min`;
      if (m) return `${m} min`;
      return `${sec} s`;
    },

    async load(silent) {
      const ticket = (this._ticket = (this._ticket || 0) + 1);       // a slow old answer must not replace a newer one
      if (!silent && !this.h) this.loading = true;
      try {
        const data = await PlatformAPI.health();
        if (ticket !== this._ticket) return;
        this.h = data;
        this.loadError = "";
        this.updatedAt = new Date();
      } catch (err) {
        if (ticket !== this._ticket) return;
        if (err.status !== 401) this.loadError = err.message;          // the old numbers stay on the screen
      } finally {
        if (ticket === this._ticket) this.loading = false;
      }
    },

    setAuto() {
      try { localStorage.setItem("rt_platform_health_auto", this.auto ? "1" : "0"); } catch (_) { /* not saved */ }
      this.schedule();
    },
    schedule() {
      clearInterval(this._timer);
      this._timer = null;
      if (!this.auto) return;
      const ms = Number(window.__plHealthMs) || 30000;                 // tests may make it shorter
      this._timer = setInterval(() => { if (!document.hidden) this.load(true); }, ms);
    },
  },

  mounted() { this.load(); this.schedule(); },
  beforeUnmount() { clearInterval(this._timer); this._ticket = -1; },

  template: `
  <section data-testid="health-page">
    <p class="pl-muted pl-pad" v-if="loading && !h" data-testid="health-loading">Loading…</p>
    <div class="pl-card" v-else-if="!h">
      <p class="form-error" role="alert" data-testid="health-error">{{ loadError }}</p>
      <button type="button" class="btn btn-ghost btn-sm" data-testid="health-retry" @click="load()">Try again</button>
    </div>

    <template v-else>
      <div class="pl-health-top">
        <div class="pl-card pl-banner" data-testid="health-banner" :data-level="h.status">
          <span class="pl-pill" :class="bannerTone" data-testid="health-status">{{ levelLabel(h.status) }}</span>
          <strong data-testid="health-status-text">{{ bannerText }}</strong>
        </div>
        <label class="pl-auto"><input type="checkbox" v-model="auto" data-testid="health-auto" @change="setAuto"> Refresh every 30 s</label>
        <span class="pl-muted" data-testid="health-updated" v-if="updatedText">Updated {{ updatedText }}</span>
        <button type="button" class="btn btn-ghost btn-sm" data-testid="layout-reset" :disabled="!layoutCustom" @click="resetLayout">Reset layout</button>
        <button type="button" class="btn btn-ghost btn-sm" data-testid="health-refresh" @click="load(true)">Refresh</button>
      </div>
      <p class="form-error" role="alert" data-testid="health-error" v-if="loadError">Could not refresh: {{ loadError }}. The numbers below are old.</p>

      <div class="pl-board">
        <pl-item board="health" id="server" kind="card" label="Server">
          <article class="pl-card" data-testid="health-server">
            <h2>Server</h2>
            <dl class="pl-kv">
              <div><dt>Application</dt><dd data-testid="server-version">{{ h.server.app_version }}</dd></div>
              <div><dt>Python</dt><dd data-testid="server-python">{{ h.server.python_version }}</dd></div>
              <div><dt>Started</dt><dd data-testid="server-started">{{ fmt(h.server.started_at) }}</dd></div>
              <div><dt>Uptime</dt><dd data-testid="server-uptime">{{ uptime(h.server.uptime_seconds) }}</dd></div>
            </dl>
          </article>
        </pl-item>

        <pl-item board="health" id="databases" kind="card" label="Databases">
          <article class="pl-card" data-testid="health-databases">
            <h2>Databases</h2>
            <div class="pl-db" v-for="d in h.databases" :key="d.name" data-testid="db-row" :data-name="d.name" :data-ok="d.ok ? 'true' : 'false'">
              <div class="pl-db-head">
                <strong data-testid="db-name">{{ d.name === 'app' ? 'Application' : 'Platform' }}</strong>
                <span class="pl-pill" :class="d.ok ? 'ok' : 'bad'" data-testid="db-status">{{ d.ok ? "Reachable" : "Not reachable" }}</span>
              </div>
              <span class="pl-muted"><span class="pl-mono" data-testid="db-file">{{ d.file }}</span> · <span data-testid="db-size">{{ d.size_bytes === null ? "—" : bytes(d.size_bytes) }}</span></span>
              <span class="form-error" v-if="d.error" data-testid="db-error">{{ d.error }}</span>
            </div>
          </article>
        </pl-item>

        <pl-item board="health" id="disk" kind="card" label="Disk">
          <article class="pl-card" data-testid="health-disk">
            <h2>Disk</h2>
            <div class="pl-big" data-testid="disk-percent">{{ h.disk.used_percent }}%</div>
            <div class="pl-bar" role="progressbar" aria-label="Disk used" aria-valuemin="0" aria-valuemax="100"
                 :aria-valuenow="h.disk.used_percent" data-testid="disk-bar" :data-level="h.disk.level">
              <div class="pl-bar-fill" :style="{ width: barWidth + '%' }"></div>
            </div>
            <dl class="pl-kv">
              <div><dt>Level</dt><dd><span class="pl-pill" :class="tone(h.disk.level)" data-testid="disk-level">{{ levelLabel(h.disk.level) }}</span></dd></div>
              <div><dt>Used</dt><dd data-testid="disk-used">{{ bytes(h.disk.used_bytes) }}</dd></div>
              <div><dt>Free</dt><dd data-testid="disk-free">{{ bytes(h.disk.free_bytes) }}</dd></div>
              <div><dt>Total</dt><dd data-testid="disk-total">{{ bytes(h.disk.total_bytes) }}</dd></div>
              <div><dt>Uploaded files</dt><dd><span data-testid="uploads-size">{{ bytes(h.disk.uploads_bytes) }}</span> · <span data-testid="uploads-files">{{ n(h.disk.uploads_files) }}</span> files</dd></div>
            </dl>
            <p class="pl-muted" data-testid="disk-limits">Warning from {{ h.limits.disk_warn_percent }}%, critical from {{ h.limits.disk_critical_percent }}%.</p>
          </article>
        </pl-item>

        <pl-item board="health" id="counts" kind="card" label="In the application">
          <article class="pl-card" data-testid="health-counts">
            <h2>In the application</h2>
            <dl class="pl-kv">
              <div><dt>Users</dt><dd data-testid="count-users">{{ n(h.counts.users) }}</dd></div>
              <div><dt>Projects</dt><dd data-testid="count-projects">{{ n(h.counts.projects) }}</dd></div>
              <div><dt>Tickets</dt><dd data-testid="count-tickets">{{ n(h.counts.tickets) }}</dd></div>
            </dl>
          </article>
        </pl-item>

        <pl-item board="health" id="load" kind="card" label="Load">
          <article class="pl-card" data-testid="health-load">
            <h2>Load <span class="pl-muted">(since the server started)</span></h2>
            <dl class="pl-kv">
              <div><dt>Requests, last minute</dt><dd data-testid="load-minute">{{ n(h.load.requests_last_minute) }}</dd></div>
              <div><dt>Requests, total</dt><dd data-testid="load-total">{{ n(h.load.requests_total) }}</dd></div>
              <div><dt>Server errors, last hour</dt><dd><span data-testid="errors-hour">{{ n(h.load.errors_last_hour) }}</span> <span class="pl-pill" :class="tone(h.load.errors_level)" data-testid="errors-level">{{ levelLabel(h.load.errors_level) }}</span></dd></div>
              <div><dt>Server errors, total</dt><dd data-testid="errors-total">{{ n(h.load.errors_total) }}</dd></div>
            </dl>
          </article>
        </pl-item>

      <pl-item board="health" id="errors" kind="wide" label="Latest server errors">
        <article class="pl-card pl-table-card" data-testid="health-errors">
          <h2 class="pl-pad" style="padding-bottom:0">Latest server errors</h2>
          <p class="pl-muted pl-pad" v-if="!h.recent_errors.length" data-testid="errors-empty">No server errors since the server started.</p>
          <div class="pl-table-wrap" v-else>
            <table class="pl-table" data-testid="errors-table">
              <thead><tr><th>Time</th><th>Call</th><th>Status</th><th>Error</th></tr></thead>
              <tbody>
                <tr v-for="(e, i) in h.recent_errors" :key="i" data-testid="error-row">
                  <td class="pl-nowrap" data-testid="error-time">{{ fmt(e.at) }}</td>
                  <td><span data-testid="error-method">{{ e.method }}</span> <span class="pl-mono" data-testid="error-path">{{ e.path }}</span></td>
                  <td data-testid="error-status">{{ e.status }}</td>
                  <td class="pl-mono" data-testid="error-class">{{ e.error || "—" }}</td>
                </tr>
              </tbody>
            </table>
          </div>
        </article>
      </pl-item>
      </div>
    </template>
  </section>`,
};
