/* ============================================================
   Rapid Task — a ticket as a full page: /ticket.html?key=TP-5
   The page only finds the project of the ticket and shows the shared ticket editor in "page" mode.
   ============================================================ */

const { createApp } = Vue;

const app = createApp({
  data() {
    return {
      me: null, role: null, project: null, projectId: NaN, ticketKey: null,
      loading: true, error: "", showProfile: false, langTick: 0,
    };
  },
  methods: {
    i18nGet(key) { void this.langTick; return i18nGet(key); },
    onProfileUpdated(user) { this.me = user; },

    // the editor closes itself only after a delete or when the ticket cannot be opened
    leave() { location.href = this.projectId ? `/board.html?project=${this.projectId}` : "/dashboard.html"; },
    onChanged() { /* saved: the editor reloads the ticket itself */ },

    async load() {
      this.loading = true;
      try {
        const ticket = await API.ticketByKey(this.ticketKey);
        const [me, project, stats] = await Promise.all([
          API.me(), API.project(ticket.project_id), API.projectStats(ticket.project_id),
        ]);
        this.me = me;
        this.project = project;
        this.role = stats.role;
        this.projectId = ticket.project_id;
        document.title = `${ticket.key} — ${i18nGet("ticket.page_title")}`;
      } catch (err) {
        if (err.status === 401) { location.href = "/"; return; }
        this.error = err.message;
      } finally {
        this.loading = false;
      }
    },
  },

  async mounted() {
    document.title = i18nGet("ticket.page_title");
    if (!API.token()) { location.href = "/"; return; }
    const key = new URLSearchParams(location.search).get("key") || "";
    if (!/^[A-Za-z0-9_-]+-\d+$/.test(key)) { this.error = i18nGet("ticket.bad_key"); this.loading = false; return; }
    this.ticketKey = key.toUpperCase();
    await this.load();
    document.querySelectorAll(".lang-switch button").forEach((btn) => {
      btn.addEventListener("click", () => setTimeout(() => { this.langTick++; }, 0));
    });
  },

  updated() { applyI18n(); },
});

registerSharedComponents(app);
registerTicketDialogs(app);
app.mount("#app");
