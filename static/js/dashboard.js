/* ============================================================
   Rapid Task — дашборд (Vue 3, CDN, без збірки)
   Панель керування: статистика, проекти, створення, адмінка.
   ============================================================ */

const { createApp } = Vue;

createApp({
  data() {
    return {
      me: null,
      loading: true,
      loadError: "",

      stats: null,

      // створення проекту
      showCreate: false,
      createForm: { name: "", key: "", language: "uk" },
      createError: "",
      creating: false,

      // налаштування проекту (модалка)
      settings: null,      // { project, columns, members, tab, isAdmin, isOwner }
      settingsTab: "columns",
      newColumnName: "",
      newMember: { email: "", role: "contributor" },
      memberError: "",
      columnError: "",
      settingsError: "",

      roles: ["admin", "editor", "contributor", "reporter"],
    };
  },

  computed: {
    sortedColumns() {
      return this.settings
        ? [...this.settings.columns].sort((a, b) => a.position - b.position)
        : [];
    },

    totals() {
      if (!this.stats) return { projects: 0, tickets: 0, open: 0, avg: null };
      const projects = this.stats.projects.length;
      const tickets = this.stats.tickets_total;
      const open = this.stats.projects.reduce((s, p) => s + p.tickets_open, 0);
      return { projects, tickets, open, avg: this.stats.avg_lifetime_hours };
    },
  },

  methods: {
    i18nGet,
    typeMeta,
    typeLabel,

    async load() {
      this.loading = true;
      this.loadError = "";
      try {
        const [me, stats] = await Promise.all([API.me(), API.dashboard()]);
        this.me = me;
        this.stats = stats;
      } catch (err) {
        if (err.status === 401) {
          API.setToken(null);
          location.href = "/";
          return;
        }
        this.loadError = `${i18nGet("dash.error.load")}: ${err.message}`;
      } finally {
        this.loading = false;
      }
    },

    // --- створення проекту ---
    openCreate() {
      this.createForm = { name: "", key: "", language: "uk" };
      this.createError = "";
      this.showCreate = true;
    },

    async submitCreate() {
      this.createError = "";
      this.creating = true;
      try {
        const payload = {
          name: this.createForm.name.trim(),
          key: this.createForm.key.trim().toUpperCase(),
          language: this.createForm.language,
        };
        await API.createProject(payload);
        this.showCreate = false;
        await this.load();
      } catch (err) {
        this.createError = err.message;
      } finally {
        this.creating = false;
      }
    },

    // --- модалка налаштувань ---
    async openSettings(project) {
      this.settingsTab = "columns";
      this.newColumnName = "";
      this.newMember = { email: "", role: "contributor" };
      this.memberError = this.columnError = this.settingsError = "";

      try {
        const [detail, members] = await Promise.all([
          API.project(project.project_id),
          API.members(project.project_id),
        ]);
        this.settings = {
          projectId: project.project_id,
          project: detail,
          columns: detail.columns,
          members,
          isAdmin: project.role === "admin",
          isOwner: detail.owner.id === this.me.id,
        };
      } catch (err) {
        this.settingsError = err.message;
      }
    },

    closeSettings() {
      this.settings = null;
      this.load(); // оновити статистику на фоні
    },

    // --- колонки ---
    async reloadColumns() {
      this.settings.columns = await API.columns(this.settings.projectId);
    },

    async addColumn() {
      this.columnError = "";
      if (!this.newColumnName.trim()) return;
      try {
        await API.createColumn(this.settings.projectId, { name: this.newColumnName.trim() });
        this.newColumnName = "";
        await this.reloadColumns();
      } catch (err) {
        this.columnError = err.message;
      }
    },

    async renameColumn(col) {
      if (!col.name.trim()) return;
      try {
        await API.updateColumn(this.settings.projectId, col.id, { name: col.name.trim() });
      } catch (err) {
        this.columnError = err.message;
      }
    },

    async toggleDone(col) {
      try {
        await API.updateColumn(this.settings.projectId, col.id, { is_done: col.is_done });
        await this.reloadColumns();
      } catch (err) {
        this.columnError = err.message;
      }
    },

    async moveColumn(col, dir) {
      const sorted = [...this.settings.columns].sort((a, b) => a.position - b.position);
      const idx = sorted.findIndex(c => c.id === col.id);
      const neighbor = sorted[idx + dir];
      if (!neighbor) return;

      try {
        await API.updateColumn(this.settings.projectId, col.id, { position: neighbor.position });
        await API.updateColumn(this.settings.projectId, neighbor.id, { position: col.position });
        await this.reloadColumns();
      } catch (err) {
        this.columnError = err.message;
      }
    },

    async deleteColumn(col, moveTo = null) {
      this.columnError = "";
      try {
        await API.deleteColumn(this.settings.projectId, col.id, moveTo);
        await this.reloadColumns();
      } catch (err) {
        if (err.status === 409) {
          // у колонці є тікети — показуємо вибір куди перенести
          col.needsMove = true;
          col.moveTarget = this.settings.columns.find(c => c.id !== col.id)?.id ?? null;
        } else {
          this.columnError = err.message;
        }
      }
    },

    // --- учасники ---
    async addMember() {
      this.memberError = "";
      if (!this.newMember.email.trim()) return;
      try {
        await API.addMember(this.settings.projectId, {
          email: this.newMember.email.trim(),
          role: this.newMember.role,
        });
        this.newMember = { email: "", role: "contributor" };
        this.settings.members = await API.members(this.settings.projectId);
      } catch (err) {
        this.memberError = err.message;
      }
    },

    async changeRole(member) {
      try {
        await API.updateMemberRole(this.settings.projectId, member.user.id, member.role);
      } catch (err) {
        this.memberError = err.message;
        await this.reloadMembers();
      }
    },

    async removeMember(member) {
      this.memberError = "";
      try {
        await API.removeMember(this.settings.projectId, member.user.id);
        this.settings.members = await API.members(this.settings.projectId);
      } catch (err) {
        this.memberError = err.message;
      }
    },

    async reloadMembers() {
      this.settings.members = await API.members(this.settings.projectId);
    },

    // --- видалення проекту ---
    async deleteProject() {
      if (!confirm(i18nGet("dash.settings.delete_confirm"))) return;
      try {
        await API.deleteProject(this.settings.projectId);
        this.settings = null;
        await this.load();
      } catch (err) {
        this.settingsError = err.message;
      }
    },

    isOwnerMember(member) {
      return this.settings && member.user.id === this.settings.project.owner.id;
    },

    isMe(member) {
      return this.me && member.user.id === this.me.id;
    },

    openBoard(project) {
      location.href = `/board.html?project=${project.project_id}`;
    },

    logout() {
      API.setToken(null);
      location.href = "/";
    },
  },

  async mounted() {
    if (!API.token()) {
      location.href = "/";
      return;
    }
    await this.load();
  },

  // Vue перерендерює шаблон і затирає data-i18n текст —
  // після кожного оновлення повторно застосовуємо переклади
  updated() {
    applyI18n();
  },
}).mount("#app");
