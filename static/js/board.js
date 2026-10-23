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

const app = createApp({
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

      // TP-6: вкладення нового тікета (завантажені до його створення) та підзадачі (TP-9)
      createAttachments: [],
      createSubtasks: [],
      uploading: false,
      uploadTarget: null,   // "create" | "edit" — куди йде вибір файлів
      descEditing: false,   // TP-7: опис заблокований, поки не клікнули по полю

      // TP-8: особистий кабінет
      showProfile: false,

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

    // користувачі-учасники проекту (для спадних меню з аватарками)
    memberUsers() {
      return this.members.map(m => m.user);
    },

    // TP-9: типи підзадач, дозволені для типу тікета, що створюється
    createSubtaskTypes() {
      return CHILD_ALLOWED[this.createForm.type] || [];
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

  watch: {
    // при зміні типу тікета підзадачі з недозволеними типами коригуємо/прибираємо
    "createForm.type"() {
      const allowed = this.createSubtaskTypes;
      if (!allowed.length) { this.createSubtasks = []; return; }
      this.createSubtasks.forEach(sub => {
        if (!allowed.includes(sub.type)) sub.type = allowed[0];
      });
    },
  },

  methods: {
    i18nGet,
    typeMeta,
    typeLabel,
    renderDescription,

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
      this.createAttachments = [];
      this.createSubtasks = [];
      this.showCreate = true;
    },

    // закриття форми створення: файли, що не були прив'язані до тікета, прибираємо
    closeCreate() {
      const orphans = this.createAttachments;
      this.createAttachments = [];
      this.createSubtasks = [];
      this.showCreate = false;
      orphans.forEach(a => API.deleteAttachment(a.id).catch(() => {}));
    },

    // --- TP-9: підзадачі у формі створення ---
    addSubtaskRow() {
      const allowed = this.createSubtaskTypes;
      if (!allowed.length) return;
      this.createSubtasks.push({
        type: allowed.includes("Subtask") ? "Subtask" : allowed[0],
        title: "",
        assignee_id: null,
      });
    },

    removeSubtaskRow(i) {
      this.createSubtasks.splice(i, 1);
    },

    // --- TP-6: файли ---
    pickFiles(target) {
      this.uploadTarget = target;
      this.$refs.fileInput.click();
    },

    onFilesPicked(e) {
      const list = Array.from(e.target.files || []);
      e.target.value = "";
      this.uploadFiles(list, this.uploadTarget);
    },

    onPaste(e, target) {
      const files = Array.from((e.clipboardData && e.clipboardData.files) || []);
      if (!files.length) return;   // звичайний текст вставляється як є
      e.preventDefault();
      this.uploadFiles(files, target);
    },

    onDrop(e, target) {
      const files = Array.from((e.dataTransfer && e.dataTransfer.files) || []);
      if (files.length) this.uploadFiles(files, target);
    },

    async uploadFiles(files, target) {
      if (!files.length) return;
      const isCreate = target === "create";
      const errField = isCreate ? "createError" : "editError";
      this[errField] = "";
      this.uploading = true;
      try {
        for (const file of files) {
          const ticketId = isCreate ? null : this.editTicket.id;
          const att = await API.uploadAttachment(this.projectId, ticketId, file);
          if (isCreate) this.createAttachments.push(att);
          else this.editTicket.attachments.push(att);

          // зображення/відео вставляємо в текст опису в позицію курсора
          // (у режимі редагування опису); решта файлів — лише в прев'ю
          const kind = mediaKind(att);
          const editingText = isCreate || this.descEditing;
          if (editingText && (kind === "image" || kind === "video")) {
            this.insertIntoDescription(target, mediaToken(att));
          }
        }
      } catch (err) {
        this[errField] = err.message;
      } finally {
        this.uploading = false;
      }
    },

    insertIntoDescription(target, token) {
      const isCreate = target === "create";
      const textarea = isCreate ? this.$refs.createDesc : this.$refs.editDesc;
      const holder = isCreate ? this.createForm : this.editTicket;
      const { text, cursor } = insertAtCursor(textarea, holder.description || "", token);
      holder.description = text;
      this.$nextTick(() => {
        if (textarea) { textarea.focus(); textarea.setSelectionRange(cursor, cursor); }
      });
    },

    async removeAttachment(att, target) {
      const isCreate = target === "create";
      const holder = isCreate ? this.createForm : this.editTicket;
      const errField = isCreate ? "createError" : "editError";
      try {
        await API.deleteAttachment(att.id);
        if (isCreate) this.createAttachments = this.createAttachments.filter(a => a.id !== att.id);
        else this.editTicket.attachments = this.editTicket.attachments.filter(a => a.id !== att.id);
        holder.description = stripMediaToken(holder.description, att.url);
      } catch (err) {
        this[errField] = err.message;
      }
    },

    // --- TP-7: клік по заблокованому опису відкриває редагування ---
    onDescClick(e) {
      if (!this.canEdit(this.editTicket)) return;
      if (e.target.closest("a, video")) return;   // посилання/відео працюють як звичайно
      this.descEditing = true;
      this.$nextTick(() => {
        const ta = this.$refs.editDesc;
        if (ta) { ta.focus(); ta.setSelectionRange(ta.value.length, ta.value.length); }
      });
    },

    // --- TP-8: профіль оновлено ---
    async onProfileUpdated(user) {
      this.me = user;
      try {
        // оновлюємо імена/аватари в учасниках та на картках
        const [members, tickets] = await Promise.all([
          API.members(this.projectId),
          API.projectTickets(this.projectId),
        ]);
        this.members = members;
        this.tickets = tickets;
      } catch (_) { /* не критично */ }
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
        const subtasks = this.createSubtasks
          .filter(sub => sub.title.trim())
          .map(sub => ({
            title: sub.title.trim(),
            type: sub.type,
            assignee_id: sub.assignee_id || null,
          }));
        await API.createTicket(this.projectId, {
          ...this.createForm,
          title: this.createForm.title.trim(),
          parent_id: this.createForm.parent_id || null,
          subtasks,
          attachment_ids: this.createAttachments.map(a => a.id),
        });
        // файли прив'язані до тікета — не видаляємо їх при закритті форми
        this.createAttachments = [];
        this.createSubtasks = [];
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
        reporter: ticket.reporter || null,
        reporter_name: ticket.reporter ? ticket.reporter.full_name : "—",
        attachments: [...(ticket.attachments || [])],
      };
      this.descEditing = false;   // TP-7: опис завжди відкривається заблокованим
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
    document.title = i18nGet("board.page_title");
    if (!API.token()) { location.href = "/"; return; }

    const params = new URLSearchParams(location.search);
    const rawProject = params.get("project") || "";
    // strict: digits only, otherwise treat as invalid (parseInt would accept "1' OR 1=1" as 1)
    this.projectId = /^\d+$/.test(rawProject) ? Number(rawProject) : NaN;

    await this.load();
    this.initSortable();

    // стежимо за появою нових списків (після завантаження даних)
    this.$watch(() => this.tickets.length, () => this.initSortable());
  },

  updated() {
    applyI18n();
  },
});

registerSharedComponents(app);
app.mount("#app");
