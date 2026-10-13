/* ============================================================
   Rapid Task — Kanban-борда проекту (Vue 3 + Sortable.js)
   Колонки проекту, тікети, створення/редагування/перетягування,
   права за ролями.
   ============================================================ */

const { createApp } = Vue;

const TICKET_TYPES = ["Idea", "Epic", "Task", "Subtask", "Bug", "Incident"];

// ієрархія: дозволені типи дітей для кожного типу батька
const CHILD_ALLOWED = {
  Idea: ["Epic", "Task"],
  Epic: ["Task", "Subtask", "Bug"],
  Task: ["Subtask", "Bug", "Incident"],
};

createApp({
  data() {
    return {
      me: null,
      role: null,          // роль поточного користувача в проекті
      project: null,
      columns: [],
      tickets: [],
      members: [],

      loading: true,
      error: "",
      boardKey: 0,  // зміщувач для повного перерендеру борди після drag&drop

      // створення тікета
      showCreate: false,
      createForm: { title: "", type: "Task", description: "", column_id: null, parent_id: null, assignee_id: null, tester_id: null },
      createError: "",

      // швидка підзадача у вікні тікета
      quickAdd: { type: null, title: "", assignee_id: null },
      quickError: "",

      // редагування тікета
      editTicket: null,    // копія тікета для модалки
      editError: "",

      types: TICKET_TYPES,
    };
  },

  computed: {
    sortedColumns() {
      return [...this.columns].sort((a, b) => a.position - b.position);
    },

    // типи, дозволені для обраного батька у формі створення
    createTypeOptions() {
      if (!this.createForm.parent_id) return this.types;
      const parent = this.tickets.find(t => t.id === this.createForm.parent_id);
      return parent ? (CHILD_ALLOWED[parent.type] || []) : this.types;
    },

    // типи, дозволені для швидкої підзадачи поточного тікета
    quickAddTypes() {
      return this.editTicket ? (CHILD_ALLOWED[this.editTicket.type] || []) : [];
    },

    // всі тікети проекту для вибору батька (крім редагованого)
    parentOptions() {
      return this.tickets.map(t => ({ id: t.id, key: t.key, title: t.title, type: t.type }));
    },

    doneColumnId() {
      const done = this.columns.find(c => c.is_done);
      return done ? done.id : null;
    },
  },

  methods: {
    i18nGet,
    typeMeta,
    typeLabel,

    ticketsOf(col) {
      return this.tickets.filter(t => t.column_id === col.id);
    },

    seqOf(t) {
      const m = /-(\d+)$/.exec(t.key || "");
      return m ? parseInt(m[1], 10) : t.id;
    },

    // Групи "сімейств" у колонці: предок зверху, діти під ним з відступом.
    // Якщо предок в іншій колонці — група все одно склеюється,
    // з чипом-посиланням на батька угорі.
    groupsFor(col) {
      const colTickets = this.tickets.filter(t => t.column_id === col.id);
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

    canEdit(ticket) {
      if (!this.me) return false;
      if (this.role === "admin" || this.role === "editor") return true;
      if (this.role === "contributor") {
        // працює і з об'єктом тікета з API (reporter.id), і з копією модалки (reporter_id)
        const reporterId = ticket.reporter ? ticket.reporter.id : ticket.reporter_id;
        const assigneeId = ticket.assignee ? ticket.assignee.id : ticket.assignee_id;
        const testerId = ticket.tester ? ticket.tester.id : ticket.tester_id;
        return [reporterId, assigneeId, testerId].includes(this.me.id);
      }
      return false; // reporter — тільки створення
    },

    canDelete() {
      return this.role === "admin";
    },

    async load() {
      this.loading = true;
      try {
        const [me, project, tickets, members, stats] = await Promise.all([
          API.me(),
          API.project(this.projectId),
          API.projectTickets(this.projectId),
          API.members(this.projectId),
          API.projectStats(this.projectId),
        ]);
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

    // --- створення ---
    openCreate(columnId = null, parentId = null) {
      const first = this.sortedColumns[0];
      this.createForm = {
        title: "",
        type: "Task",
        description: "",
        column_id: columnId ?? (first ? first.id : null),
        parent_id: parentId,
        assignee_id: null,
        tester_id: null,
      };
      // якщо заданий батько — тип одразу обираємо з дозволених дітей
      if (parentId) {
        const parent = this.tickets.find(t => t.id === parentId);
        const allowed = parent ? (CHILD_ALLOWED[parent.type] || []) : this.types;
        if (allowed.length && !allowed.includes(this.createForm.type)) {
          this.createForm.type = allowed[0];
        }
      }
      this.createError = "";
      this.showCreate = true;
    },

    onParentChange() {
      // при зміні батька тип мусить бути з дозволених
      const allowed = this.createTypeOptions;
      if (allowed.length && !allowed.includes(this.createForm.type)) {
        this.createForm.type = allowed[0];
      }
    },

    async submitCreate() {
      this.createError = "";
      if (!this.createForm.title.trim()) return;
      try {
        await API.createTicket(this.projectId, {
          ...this.createForm,
          title: this.createForm.title.trim(),
          parent_id: this.createForm.parent_id || null,
        });
        this.showCreate = false;
        this.tickets = await API.projectTickets(this.projectId);
      } catch (err) {
        this.createError = err.message;
      }
    },

    // --- редагування ---
    openEdit(ticket) {
      this.editTicket = {
        id: ticket.id,
        key: ticket.key,
        title: ticket.title,
        description: ticket.description || "",
        type: ticket.type,
        column_id: ticket.column_id,
        parent_id: ticket.parent_id ?? null,
        ancestors: ticket.ancestors || [],
        assignee_id: ticket.assignee ? ticket.assignee.id : null,
        tester_id: ticket.tester ? ticket.tester.id : null,
        reporter_id: ticket.reporter ? ticket.reporter.id : null,
        reporter_name: ticket.reporter ? ticket.reporter.full_name : "—",
      };
      this.quickAdd = { type: this.quickAddTypes[0] || null, title: "", assignee_id: null };
      this.quickError = "";
      this.editError = "";
    },

    async openByKey(key) {
      // навігація по хлібних крихтах/посиланню на себе
      try {
        const ticket = await API.ticketByKey(key);
        this.openEdit(ticket);
      } catch (err) {
        alert(err.message);
      }
    },

    async submitQuickAdd() {
      this.quickError = "";
      if (!this.quickAdd.type || !this.quickAdd.title.trim()) return;
      try {
        await API.createTicket(this.projectId, {
          title: this.quickAdd.title.trim(),
          type: this.quickAdd.type,
          parent_id: this.editTicket.id,
          assignee_id: this.quickAdd.assignee_id || null,
        });
        this.tickets = await API.projectTickets(this.projectId);
        // оновлюємо відкритий тікет, щоб підхватити свіжі предки/дітей
        const fresh = await API.ticketByKey(this.editTicket.key);
        this.openEdit(fresh);
      } catch (err) {
        this.quickError = err.message;
      }
    },

    async saveEdit() {
      this.editError = "";
      try {
        await API.updateTicket(this.editTicket.id, {
          title: this.editTicket.title.trim(),
          description: this.editTicket.description,
          type: this.editTicket.type,
          column_id: this.editTicket.column_id,
          assignee_id: this.editTicket.assignee_id,
          tester_id: this.editTicket.tester_id,
        });
        this.editTicket = null;
        this.tickets = await API.projectTickets(this.projectId);
      } catch (err) {
        this.editError = err.message;
      }
    },

    async deleteCurrent() {
      if (!confirm(i18nGet("dash.settings.delete_confirm"))) return;
      try {
        await API.deleteTicket(this.editTicket.id);
        this.editTicket = null;
        this.tickets = await API.projectTickets(this.projectId);
      } catch (err) {
        this.editError = err.message;
      }
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
      this.tickets = await API.projectTickets(this.projectId);
      this.initSortable();
    },

    memberName(id) {
      const m = this.members.find(x => x.user.id === id);
      return m ? m.user.full_name : `#${id}`;
    },
  },

  async mounted() {
    if (!API.token()) { location.href = "/"; return; }

    const params = new URLSearchParams(location.search);
    this.projectId = parseInt(params.get("project"), 10);

    await this.load();
    this.initSortable();

    // стежимо за появою нових списків (після завантаження даних)
    this.$watch(() => this.tickets.length, () => this.initSortable());
  },

  updated() {
    applyI18n();
  },
}).mount("#app");
