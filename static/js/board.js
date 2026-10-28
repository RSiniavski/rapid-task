/* ============================================================
   Rapid Task — Kanban-борда проекту (Vue 3 + Sortable.js)
   Колонки проекту, тікети, перетягування, фільтри, права за ролями.
   Створення/редагування тікета — спільні діалоги (js/ticket-dialogs.js).
   ============================================================ */

const { createApp } = Vue;

const app = createApp({
  data() {
    return {
      projectId: null,     // з адреси сторінки (?project=)
      me: null,
      role: null,          // роль поточного користувача в проекті
      project: null,
      columns: [],
      tickets: [],
      members: [],

      loading: true,
      error: "",
      boardKey: 0,  // зміщувач для повного перерендеру борди після drag&drop

      // діалоги тікета (спільні компоненти)
      showCreate: false,
      createDefaults: {},
      editKey: null,       // ключ тікета, відкритого у діалозі редагування

      tagOptions: [],      // для фільтрів
      componentOptions: [],
      notice: "",
      noticeTimer: null,

      // TP-8: особистий кабінет
      showProfile: false,

      // фільтри дошки (зберігаються в браузері окремо для кожного проекту)
      filters: { type: null, tag_ids: [], component_ids: [], reporter_id: null, assignee_ids: [], tester_id: null },
      showFilters: false,

      types: TICKET_TYPES,
    };
  },

  computed: {
    sortedColumns() {
      return [...this.columns].sort((a, b) => a.position - b.position);
    },

    otherFiltersCount() {
      const f = this.filters;
      return (f.type ? 1 : 0) + (f.tag_ids.length ? 1 : 0) + (f.component_ids.length ? 1 : 0)
        + (f.reporter_id ? 1 : 0) + (f.tester_id ? 1 : 0);
    },
    hasFilters() { return this.filters.assignee_ids.length > 0 || this.otherFiltersCount > 0; },
    // people for the avatar strip: assignees who have tickets on the board (+ selected ones)
    assigneesOnBoard() {
      const ids = new Set(this.filters.assignee_ids);
      for (const t of this.tickets) if (t.assignee) ids.add(t.assignee.id);
      const byId = new Map(this.members.map(m => [m.user.id, m.user]));
      return [...ids].map(id => byId.get(id)).filter(Boolean)
        .sort((a, b) => a.full_name.localeCompare(b.full_name));
    },
    filteredCount() { return this.tickets.filter(t => this.matches(t)).length; },

    // користувачі-учасники проекту (для спадних меню з аватарками)
    memberUsers() {
      return this.members.map(m => m.user);
    },

    doneColumnId() {
      const done = this.columns.find(c => c.is_done);
      return done ? done.id : null;
    },
  },

  watch: {
    filters: { deep: true, handler() { this.saveFilters(); } },
  },

  methods: {
    i18nGet,
    typeMeta,
    typeLabel,
    renderDescription,

    ticketsOf(col) {
      return this.tickets.filter(t => t.column_id === col.id && this.matches(t));
    },

    matches(t) {
      const f = this.filters;
      if (f.type && t.type !== f.type) return false;
      if (f.tag_ids.length && !(t.tags || []).some(x => f.tag_ids.includes(x.id))) return false;
      if (f.component_ids.length && !(t.components || []).some(x => f.component_ids.includes(x.id))) return false;
      if (f.reporter_id && (!t.reporter || t.reporter.id !== f.reporter_id)) return false;
      if (f.assignee_ids.length && (!t.assignee || !f.assignee_ids.includes(t.assignee.id))) return false;
      if (f.tester_id && (!t.tester || t.tester.id !== f.tester_id)) return false;
      return true;
    },

    filtersKey() { return "rt_board_filters_" + this.projectId; },

    loadFilters() {
      try {
        const saved = JSON.parse(localStorage.getItem(this.filtersKey()) || "null");
        if (!saved || typeof saved !== "object") return;
        const memberIds = new Set(this.members.map(m => m.user.id));
        const tagIds = new Set(this.tagOptions.map(x => x.id));
        const compIds = new Set(this.componentOptions.map(x => x.id));
        const keepUser = (id) => (memberIds.has(id) ? id : null);
        this.filters = {
          type: this.types.includes(saved.type) ? saved.type : null,
          tag_ids: (saved.tag_ids || []).filter(id => tagIds.has(id)),
          component_ids: (saved.component_ids || []).filter(id => compIds.has(id)),
          reporter_id: keepUser(saved.reporter_id),
          assignee_ids: (Array.isArray(saved.assignee_ids) ? saved.assignee_ids
            : (saved.assignee_id ? [saved.assignee_id] : [])).filter(id => memberIds.has(id)),
          tester_id: keepUser(saved.tester_id),
        };
      } catch (_) { /* damaged saved data: ignore */ }
    },

    saveFilters() {
      try { localStorage.setItem(this.filtersKey(), JSON.stringify(this.filters)); } catch (_) {}
    },

    resetFilters() {
      this.filters = { type: null, tag_ids: [], component_ids: [], reporter_id: null, assignee_ids: [], tester_id: null };
    },
    toggleAssignee(id) {
      const list = this.filters.assignee_ids;
      this.filters.assignee_ids = list.includes(id) ? list.filter(x => x !== id) : [...list, id];
      this.showFilters = this.otherFiltersCount > 0;
    },

    seqOf(t) {
      const m = /-(\d+)$/.exec(t.key || "");
      return m ? parseInt(m[1], 10) : t.id;
    },

    // Групи "сімейств" у колонці: предок зверху, діти під ним з відступом.
    // Якщо предок в іншій колонці — група все одно склеюється,
    // з чипом-посиланням на батька угорі.
    groupsFor(col) {
      const colTickets = this.tickets.filter(t => t.column_id === col.id && this.matches(t));
      if (!colTickets.length) return [];

      const byId = new Map(this.tickets.map(t => [t.id, t]));
      const colIds = new Set(colTickets.map(t => t.id));

      const childrenMap = new Map();
      for (const t of this.tickets) {
        if (t.parent_id) {
          if (!childrenMap.has(t.parent_id)) childrenMap.set(t.parent_id, []);
          childrenMap.get(t.parent_id).push(t);
        }
      }

      // анкор: верхівка гілки в межах цієї колонки
      const anchorOf = (t) => {
        let cur = t;
        while (cur.parent_id) {
          const p = byId.get(cur.parent_id);
          if (!p || !colIds.has(p.id)) break;
          cur = p;
        }
        return cur;
      };

      const groupsMap = new Map();
      for (const t of colTickets) {
        const anchor = anchorOf(t);
        if (!groupsMap.has(anchor.id)) {
          groupsMap.set(anchor.id, { anchorId: anchor.id, label: null, labelKey: null, items: [] });
        }
        const g = groupsMap.get(anchor.id);
        if (anchor.parent_id && !g.label) {
          const p = byId.get(anchor.parent_id);
          if (p) { g.label = p.key; g.labelKey = p.key; }
        }
      }

      // DFS: предок перший, діти під ним
      for (const g of groupsMap.values()) {
        const anchor = byId.get(g.anchorId);
        const add = (t, depth) => {
          g.items.push({ ticket: t, depth });
          const kids = (childrenMap.get(t.id) || [])
            .filter(c => colIds.has(c.id))
            .sort((a, b) => this.seqOf(a) - this.seqOf(b));
          for (const k of kids) add(k, depth + 1);
        };
        add(anchor, 0);
      }

      const groups = [...groupsMap.values()];
      groups.sort((a, b) => this.seqOf(byId.get(a.anchorId)) - this.seqOf(byId.get(b.anchorId)));

      // класи склеювання: спільне тло, заокруглені край групи
      for (const g of groups) {
        g.items.forEach((item, i) => {
          const cl = ["in-family"];
          if (i === 0 && g.items.length > 1) cl.push("family-start");
          if (i === g.items.length - 1 && g.items.length > 1) cl.push("family-end");
          item.classes = cl;
        });
      }
      return groups;
    },

    canDelete() {
      return this.role === "admin";
    },

    showNotice(text) {
      this.notice = text;
      clearTimeout(this.noticeTimer);
      this.noticeTimer = setTimeout(() => { this.notice = ""; }, 6000);
    },

    async load() {
      this.loading = true;
      try {
        const [me, project, tickets, members, stats, tags, components] = await Promise.all([
          API.me(),
          API.project(this.projectId),
          API.projectTickets(this.projectId, "board"),
          API.members(this.projectId),
          API.projectStats(this.projectId),
          API.tags(this.projectId),
          API.components(this.projectId),
        ]);
        this.tagOptions = tags;
        this.componentOptions = components;
        this.me = me;
        this.project = project;
        this.tickets = tickets;
        this.members = members;
        this.columns = project.columns;
        this.role = stats.role;
      } catch (err) {
        if (err.status === 401) { location.href = "/"; return; }
        if (err.status === 403) { this.error = err.message; }
        else { this.error = `${i18nGet("dash.error.load")}: ${err.message}`; }
      } finally {
        this.loading = false;
      }
    },

    // --- діалоги тікета ---
    openCreate(columnId = null, parentId = null) {
      this.createDefaults = { column_id: columnId, parent_id: parentId };
      this.showCreate = true;
    },

    openEdit(ticket) { this.editKey = ticket.key; },

    openByKey(key) { this.editKey = key; },

    async refreshTickets() {
      this.tickets = await API.projectTickets(this.projectId, "board");
    },

    // a ticket was created in the shared dialog
    async onCreated(created) {
      await this.refreshTickets();
      if (!this.tickets.some(t => t.id === created.id)) this.showNotice(i18nGet("board.in_backlog"));
      await this.reloadLabels();     // new tags/components may have been created by the server
    },

    // a ticket was saved / deleted / got a subtask in the shared dialog
    async onChanged(change) {
      await this.refreshTickets();
      if (change.action === "saved" && !this.tickets.some(t => t.id === change.id)) {
        this.showNotice(i18nGet("board.in_backlog"));
      }
      await this.reloadLabels();
    },

    // --- TP-8: профіль оновлено ---
    async onProfileUpdated(user) {
      this.me = user;
      try {
        // оновлюємо імена/аватари в учасниках та на картках
        const [members, tickets] = await Promise.all([
          API.members(this.projectId),
          API.projectTickets(this.projectId, "board"),
        ]);
        this.members = members;
        this.tickets = tickets;
      } catch (_) { /* не критично */ }
    },

    async reloadLabels() {
      [this.tagOptions, this.componentOptions] = await Promise.all([
        API.tags(this.projectId), API.components(this.projectId),
      ]);
    },

    hiddenLabels(t) {
      return Math.max(0, (t.tags || []).length - 3) + Math.max(0, (t.components || []).length - 2);
    },

    // --- drag & drop ---
    initSortable() {
      this.$nextTick(() => {
        document.querySelectorAll(".ticket-list").forEach(list => {
          if (list._sortable) list._sortable.destroy();
          list._sortable = Sortable.create(list, {
            group: "board",
            animation: 160,
            ghostClass: "drag-ghost",
            draggable: ".ticket-card",  // заголовки груп не таскаються
            onEnd: (evt) => this.onDrop(evt),
          });
        });
      });
    },

    async onDrop(evt) {
      const ticketId = parseInt(evt.item.dataset.ticketId, 10);
      const toColumnId = parseInt(evt.to.dataset.columnId, 10);

      // Sortable перемістив DOM напряму — після перезавантаження даних
      // Vue перебудує борду цілком (boardKey), тому DOM-конфліктів нема
      try {
        await API.moveTicket(ticketId, toColumnId);
      } catch (err) {
        alert(err.message);
      }
      this.boardKey++;
      this.tickets = await API.projectTickets(this.projectId, "board");
      this.initSortable();
    },

    memberName(id) {
      const m = this.members.find(x => x.user.id === id);
      return m ? m.user.full_name : `#${id}`;
    },
  },

  async mounted() {
    document.title = i18nGet("board.page_title");
    if (!API.token()) { location.href = "/"; return; }

    const params = new URLSearchParams(location.search);
    const rawProject = params.get("project") || "";
    // strict: digits only, otherwise treat as invalid (parseInt would accept "1' OR 1=1" as 1)
    this.projectId = /^\d+$/.test(rawProject) ? Number(rawProject) : NaN;

    await this.load();
    this.loadFilters();
    // opened from the Backlog: show this ticket's dialog (it may not be on the board)
    const openKey = params.get("ticket");
    if (openKey && /^[A-Za-z0-9_-]+-\d+$/.test(openKey)) {
      this.openByKey(openKey);
      history.replaceState(null, "", `/board.html?project=${this.projectId}`);
    }
    this.initSortable();

    // стежимо за появою нових списків (після завантаження даних)
    this.$watch(() => this.tickets.length, () => this.initSortable());
  },

  updated() {
    applyI18n();
  },
});

registerSharedComponents(app);
registerTicketDialogs(app);
app.mount("#app");
