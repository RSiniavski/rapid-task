/* ============================================================
   Rapid Task Platform — the admin tool (single page, Vue 3)
   Sections: My account (always), the four monitoring sections and Administrators / Audit log (by permission).
   The address #/<section> keeps the place after a reload.
   ============================================================ */
(function () {
  const THEME_KEY = "rt_platform_theme";

  const { PERMS, fmt, initials } = PlatformUI;

  // soon: true = the section is not built yet (it is shown, but not clickable)
  const NAV = [
    { id: "health", label: "System Health", icon: "🖥️", perm: "can_view_system_health", group: "Monitor", soon: true },
    { id: "overview", label: "Platform Overview", icon: "📈", perm: "can_view_analytics", group: "Monitor", soon: true },
    { id: "users", label: "Users", icon: "👥", perm: "can_manage_users", group: "Monitor" },
    { id: "insights", label: "Project Insights", icon: "🚀", perm: "can_view_analytics", group: "Monitor", soon: true },
    { id: "admins", label: "Administrators", icon: "🛡️", root: true, group: "Platform" },
    { id: "audit", label: "Audit log", icon: "📜", perm: "can_view_audit_logs", group: "Platform" },
  ];

  function applyTheme(key) {
    const theme = ThemeEngine.find(key) || ThemeEngine.find(ThemeEngine.DEFAULT_KEY);
    ThemeEngine.apply(theme);                          // apply() only paints; select() would also change the app's own theme
    try { localStorage.setItem(THEME_KEY, theme.key); } catch (_) { /* private mode */ }
    return theme.key;
  }

  function savedThemeKey() {
    try {
      const key = localStorage.getItem(THEME_KEY);
      if (key && ThemeEngine.find(key)) return key;
    } catch (_) { /* default */ }
    return ThemeEngine.DEFAULT_KEY;
  }

  const app = Vue.createApp({
    data() {
      return {
        booting: true,
        admin: null,
        form: { username: "", password: "", busy: false, error: "" },
        loginInfo: "",
        rawRoute: "account",
        themeKey: savedThemeKey(),
        themes: ThemeEngine.list(),
        perms: PERMS,
        toast: null,
      };
    },

    computed: {
      myInitials() { return initials(this.admin && this.admin.display_name); },
      permCount() { return PERMS.filter((p) => this.has(p.key)).length; },
      visibleNav() { return NAV.filter((item) => this.canSee(item)); },
      navGroups() {
        const groups = [];
        for (const item of this.visibleNav) {
          let g = groups.find((x) => x.title === item.group);
          if (!g) { g = { title: item.group, items: [] }; groups.push(g); }
          g.items.push(item);
        }
        return groups;
      },
      // a section the admin may not open (or that does not exist) falls back to My account
      route() {
        const item = NAV.find((n) => n.id === this.rawRoute);
        return item && this.canSee(item) ? item.id : "account";
      },
      viewTitle() {
        if (this.route === "account") return "My account";
        const item = NAV.find((n) => n.id === this.route);
        return item ? item.label : "";
      },
    },

    methods: {
      fmt,

      // root passes every check, like on the server
      has(flag) { return !!this.admin && (this.admin.is_root || !!this.admin[flag]); },
      canSee(item) {
        if (!this.admin) return false;
        if (item.root) return !!this.admin.is_root;
        return this.has(item.perm);
      },

      readRoute() { this.rawRoute = location.hash.replace(/^#\/?/, "") || "account"; },
      go(id) {
        if (location.hash === "#/" + id) this.rawRoute = id;
        else location.hash = "#/" + id;
      },

      showTheme(key) { this.themeKey = applyTheme(key); },
      async pickTheme(key) {
        this.showTheme(key);
        try {
          await PlatformAPI.setTheme(key);
        } catch (err) {
          if (err.status !== 401) this.flash("The theme could not be saved: " + err.message, "error");
        }
      },

      // kind: "ok" (default) or "error"
      flash(message, kind) {
        this.toast = { text: message, kind: kind || "ok" };
        clearTimeout(this._toastTimer);
        this._toastTimer = setTimeout(() => { this.toast = null; }, 4500);
      },

      setAdmin(admin) {
        this.admin = admin;
        this.showTheme(admin.theme_key || ThemeEngine.DEFAULT_KEY);     // the saved choice of this admin wins
      },

      async doLogin() {
        if (this.form.busy) return;
        this.form.busy = true;
        this.form.error = "";
        try {
          const res = await PlatformAPI.login(this.form.username, this.form.password);
          PlatformAPI.setToken(res.access_token);
          this.loginInfo = "";
          this.form.password = "";
          this.setAdmin(res.admin);
        } catch (err) {
          this.form.error = err.message;
          this.form.password = "";
        } finally {
          this.form.busy = false;
        }
      },

      leave(info) {
        PlatformAPI.setToken("");
        this.admin = null;
        this.form.password = "";
        this.form.error = "";
        this.loginInfo = info || "";
        if (location.hash) location.hash = "";
        this.rawRoute = "account";
      },
      logout() { this.leave("You have been signed out."); },

      async restore() {
        if (!PlatformAPI.getToken()) return;
        try {
          this.setAdmin(await PlatformAPI.me());
        } catch (err) {
          if (err.status === 0) this.form.error = err.message;
          PlatformAPI.setToken("");
        }
      },
    },

    async mounted() {
      PlatformAPI.onSessionEnd((message) => this.leave(message));
      window.addEventListener("hashchange", () => this.readRoute());
      // the Rapid Task app (another tab) changes its own theme: keep the look of the admin tool
      window.addEventListener("storage", (e) => { if (e.key === "rt_theme") this.showTheme(this.themeKey); });
      this.readRoute();
      try { await this.restore(); } finally { this.booting = false; }
    },
  });
  app.component("platform-admins", PlatformAdmins);
  app.component("platform-audit", PlatformAudit);
  app.component("platform-users", PlatformUsers);
  app.mount("#app");
})();
