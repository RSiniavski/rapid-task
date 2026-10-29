/* ============================================================
   Rapid Task — shared ticket dialogs (Create + Edit)
   Used by the Board, the Backlog and the Roadmap, so a ticket can be
   created or edited wherever the team is working.
   Each dialog loads what it needs (members, columns, tags, milestones…)
   by itself, so a page only passes the project id.
   Load after shared.js (needs UserSelect, LabelPicker, SearchSelect, ...).
   ============================================================ */

const TICKET_TYPES = ["Idea", "Epic", "Task", "Subtask", "Bug", "Incident"];

// hierarchy: allowed child types for each parent type
const CHILD_ALLOWED = {
  Idea: ["Epic", "Task"],
  Epic: ["Task", "Subtask", "Bug"],
  Task: ["Subtask", "Bug", "Incident"],
};

// Everything a ticket dialog needs about a project.
async function loadTicketContext(projectId, { tickets = false } = {}) {
  const calls = [
    API.me(), API.project(projectId), API.members(projectId), API.projectStats(projectId),
    API.tags(projectId), API.components(projectId), API.roadmap(projectId),
    tickets ? API.projectTickets(projectId, "all") : Promise.resolve([]),
  ];
  const [me, project, members, stats, tags, components, roadmap, list] = await Promise.all(calls);
  return {
    me,
    role: stats.role,
    columns: [...project.columns].sort((a, b) => a.position - b.position),
    members,
    users: members.map((m) => m.user),
    tags,
    components,
    milestones: roadmap.milestones,
    tickets: list,
  };
}

// open milestones, plus the ticket's own milestone even if it is closed (shown with ✔, not selectable)
function milestoneChoicesFor(ctx, currentId) {
  return ctx.milestones
    .filter((m) => !m.is_closed || m.id === currentId)
    .map((m) => ({ id: m.id, name: m.title + (m.is_closed ? " ✔" : ""), disabled: m.is_closed }));
}

// ---------------------------------------------------------------- Create
const TicketCreateDialog = {
  name: "TicketCreateDialog",
  props: {
    projectId: { type: Number, default: null },
    open: { type: Boolean, default: false },
    defaults: { type: Object, default: () => ({}) },   // { parent_id, milestone_id }
  },
  emits: ["close", "created"],
  data() {
    return { ctx: null, form: null, error: "", attachments: [], subtasks: [], uploading: false, busy: false };
  },
  computed: {
    types() { return TICKET_TYPES; },
    typeOptions() {
      if (!this.form || !this.form.parent_id || !this.ctx) return TICKET_TYPES;
      const parent = this.ctx.tickets.find((t) => t.id === this.form.parent_id);
      return parent ? (CHILD_ALLOWED[parent.type] || []) : TICKET_TYPES;
    },
    subtaskTypes() { return this.form ? (CHILD_ALLOWED[this.form.type] || []) : []; },
    parentOptions() {
      return this.ctx ? this.ctx.tickets.map((t) => ({ id: t.id, key: t.key, title: t.title, type: t.type })) : [];
    },
  },
  watch: {
    open(val) { if (val) this.init(); },
    "form.type"() {
      const allowed = this.subtaskTypes;
      if (!allowed.length) { this.subtasks = []; return; }
      this.subtasks.forEach((sub) => { if (!allowed.includes(sub.type)) sub.type = allowed[0]; });
    },
  },
  methods: {
    i18nGet, typeMeta, typeLabel,

    milestoneChoices(currentId) { return milestoneChoicesFor(this.ctx, currentId); },

    async init() {
      this.error = ""; this.ctx = null; this.form = null;
      this.attachments = []; this.subtasks = [];
      try {
        this.ctx = await loadTicketContext(this.projectId, { tickets: true });
      } catch (err) {
        alert(err.message);
        this.$emit("close");
        return;
      }
      const d = this.defaults || {};
      const first = this.ctx.columns[0];
      this.form = {
        title: "", type: "Task", description: "",
        column_id: first ? first.id : null,        // a new ticket always starts in the first column
        parent_id: d.parent_id ?? null,
        milestone_id: d.milestone_id ?? null,
        assignee_id: null, tester_id: null,
        tag_ids: [], component_ids: [], new_tags: [], new_components: [],
      };
      if (this.form.parent_id) this.onParentChange();
    },

    onParentChange() {
      const allowed = this.typeOptions;
      if (allowed.length && !allowed.includes(this.form.type)) this.form.type = allowed[0];
    },

    // closing: files that were never attached to a ticket are removed
    close() {
      const orphans = this.attachments;
      this.attachments = []; this.subtasks = [];
      orphans.forEach((a) => API.deleteAttachment(a.id).catch(() => {}));
      this.$emit("close");
    },

    addSubtaskRow() {
      const allowed = this.subtaskTypes;
      if (!allowed.length) return;
      this.subtasks.push({ type: allowed.includes("Subtask") ? "Subtask" : allowed[0], title: "", assignee_id: null });
    },
    removeSubtaskRow(i) { this.subtasks.splice(i, 1); },

    // --- files ---
    pickFiles() { this.$refs.fileInput.click(); },
    onFilesPicked(e) {
      const list = Array.from(e.target.files || []);
      e.target.value = "";
      this.uploadFiles(list);
    },
    onPaste(e) {
      const files = Array.from((e.clipboardData && e.clipboardData.files) || []);
      if (!files.length) return;
      e.preventDefault();
      this.uploadFiles(files);
    },
    onDrop(e) {
      const files = Array.from((e.dataTransfer && e.dataTransfer.files) || []);
      if (files.length) this.uploadFiles(files);
    },
    async uploadFiles(files) {
      if (!files.length) return;
      this.error = "";
      this.uploading = true;
      try {
        for (const file of files) {
          const att = await API.uploadAttachment(this.projectId, null, file);
          this.attachments.push(att);
          const kind = mediaKind(att);
          if (kind === "image" || kind === "video") this.insertIntoDescription(mediaToken(att));
        }
      } catch (err) {
        this.error = err.message;
      } finally {
        this.uploading = false;
      }
    },
    insertIntoDescription(token) {
      const textarea = this.$refs.createDesc;
      const { text, cursor } = insertAtCursor(textarea, this.form.description || "", token);
      this.form.description = text;
      this.$nextTick(() => { if (textarea) { textarea.focus(); textarea.setSelectionRange(cursor, cursor); } });
    },
    async removeAttachment(att) {
      try {
        await API.deleteAttachment(att.id);
        this.attachments = this.attachments.filter((a) => a.id !== att.id);
        this.form.description = stripMediaToken(this.form.description, att.url);
      } catch (err) {
        this.error = err.message;
      }
    },

    async submit() {
      this.error = "";
      if (!this.form.title.trim() || this.busy) return;
      this.busy = true;
      try {
        const subtasks = this.subtasks
          .filter((sub) => sub.title.trim())
          .map((sub) => ({ title: sub.title.trim(), type: sub.type, assignee_id: sub.assignee_id || null }));
        const created = await API.createTicket(this.projectId, {
          ...this.form,
          title: this.form.title.trim(),
          parent_id: this.form.parent_id || null,
          subtasks,
          attachment_ids: this.attachments.map((a) => a.id),
        });
        // files are attached to the ticket now: do not delete them on close
        this.attachments = []; this.subtasks = [];
        this.$emit("created", created);
        this.$emit("close");
      } catch (err) {
        this.error = err.message;
      } finally {
        this.busy = false;
      }
    },
  },
  mounted() { applyI18n(); },
  updated() { applyI18n(); },
  template: `
  <div class="modal-backdrop" :class="{ open: open && ctx && form }" @click.self="close">
    <div class="modal modal-wide modal-ticket" v-if="open && ctx && form">
      <button class="modal-close" @click="close" aria-label="Close">✕</button>
      <h2 style="font-size: 20px; margin-bottom: 18px;" data-i18n="board.new_ticket"></h2>

      <form @submit.prevent="submit" class="tk-form">
        <div class="tk-grid">
          <!-- ===== LEFT: what you write ===== -->
          <div class="tk-main">
            <div class="field">
              <label data-i18n="ticket.title"></label>
              <input class="input" v-model="form.title" required maxlength="200"
                     @keyup.ctrl.enter="submit">
            </div>

            <div class="field">
              <label data-i18n="ticket.description"></label>
              <textarea class="input" ref="createDesc" v-model="form.description" rows="8"
                        :placeholder="i18nGet('ticket.desc_textarea')"
                        @paste="onPaste($event)" @dragover.prevent @drop.prevent="onDrop($event)"></textarea>
              <div class="attach-bar">
                <button type="button" class="btn btn-soft btn-sm" :disabled="uploading" @click="pickFiles()">
                  {{ uploading ? i18nGet('ticket.uploading') : i18nGet('ticket.attach') }}
                </button>
                <span class="muted">{{ i18nGet('ticket.attachments') }}: {{ attachments.length }}</span>
              </div>
              <attachment-grid :items="attachments" removable @remove="removeAttachment($event)"></attachment-grid>
            </div>

            <!-- TP-9: subtasks while creating -->
            <div class="field" v-if="subtaskTypes.length">
              <label data-i18n="ticket.subtasks"></label>
              <div class="subtask-box">
                <div class="subtask-row" v-for="(sub, i) in subtasks" :key="i">
                  <select class="input subtask-type" v-model="sub.type">
                    <option v-for="type in subtaskTypes" :key="type" :value="type">
                      {{ typeMeta(type).icon }} {{ typeLabel(type) }}
                    </option>
                  </select>
                  <input class="input subtask-title" v-model="sub.title" maxlength="200"
                         :placeholder="i18nGet('ticket.subtask_title')" @keydown.enter.prevent="addSubtaskRow">
                  <user-select v-model="sub.assignee_id" :users="ctx.users" :placeholder="i18nGet('ticket.assignee')"></user-select>
                  <button type="button" class="icon-btn danger" @click="removeSubtaskRow(i)"
                          :title="i18nGet('ticket.subtask_remove')">✕</button>
                </div>
                <button type="button" class="btn btn-soft btn-sm" @click="addSubtaskRow">
                  ＋ {{ i18nGet('ticket.subtask_add') }}
                </button>
              </div>
            </div>
          </div>

          <!-- ===== RIGHT: fields ===== -->
          <aside class="tk-side" data-testid="ticket-fields">
            <div class="field">
              <label data-i18n="ticket.type"></label>
              <select class="input" v-model="form.type">
                <option v-for="type in typeOptions" :key="type" :value="type">
                  {{ typeMeta(type).icon }} {{ typeLabel(type) }}
                </option>
              </select>
            </div>
            <div class="field">
              <label data-i18n="ticket.parent"></label>
              <select class="input" v-model="form.parent_id" @change="onParentChange">
                <option :value="null">—</option>
                <option v-for="opt in parentOptions" :key="opt.id" :value="opt.id">
                  {{ typeMeta(opt.type).icon }} {{ opt.key }} · {{ opt.title }}
                </option>
              </select>
            </div>
            <div class="field">
              <label>{{ i18nGet('ticket.milestone') }}</label>
              <search-select v-model="form.milestone_id" :options="milestoneChoices(null)"
                             :placeholder="i18nGet('ticket.no_milestone')" testid="create-milestone"></search-select>
            </div>
            <div class="field">
              <label data-i18n="ticket.assignee"></label>
              <user-select v-model="form.assignee_id" :users="ctx.users"></user-select>
            </div>
            <div class="field">
              <label data-i18n="ticket.tester"></label>
              <user-select v-model="form.tester_id" :users="ctx.users" stub="🧪"></user-select>
            </div>
            <div class="field">
              <label data-i18n="ticket.tags"></label>
              <label-picker v-model="form.tag_ids" v-model:pending="form.new_tags"
                            :options="ctx.tags" :name-max="30"
                            :placeholder="i18nGet('ticket.tags_placeholder')" testid="create-tags"></label-picker>
            </div>
            <div class="field">
              <label data-i18n="ticket.components"></label>
              <label-picker v-model="form.component_ids" v-model:pending="form.new_components"
                            :options="ctx.components" :name-max="50"
                            :placeholder="i18nGet('ticket.components_placeholder')" testid="create-components"></label-picker>
            </div>
          </aside>
        </div>
        <div class="form-error" v-if="error">{{ error }}</div>
        <div class="row tk-footer">
          <span class="spacer"></span>
          <button type="submit" class="btn btn-primary" data-i18n="ticket.create"></button>
        </div>
      </form>
    </div>
    <input type="file" ref="fileInput" multiple style="display: none;" @change="onFilesPicked">
</div>
  `,
};

const HISTORY_LIMIT = 10;

// ---------------------------------------------------------------- Edit
const TicketEditDialog = {
  name: "TicketEditDialog",
  props: {
    projectId: { type: Number, default: null },
    ticketKey: { type: String, default: null },        // open the dialog for this ticket key
    page: { type: Boolean, default: false },           // full page (ticket.html) instead of a modal
  },
  emits: ["close", "changed"],                          // changed: { action: "saved"|"deleted"|"subtask", id }
  data() {
    return {
      ctx: null, ticket: null, error: "", uploading: false, descEditing: false,
      quickAdd: { type: null, title: "", assignee_id: null }, quickError: "",
      historyAll: false, savedOk: false,
    };
  },
  computed: {
    historyRows() {
      if (!this.ticket) return [];
      const rows = [...this.ticket.history].sort((a, b) => b.id - a.id);
      return this.historyAll ? rows : rows.slice(0, HISTORY_LIMIT);
    },
    historyHidden() { return this.ticket ? Math.max(0, this.ticket.history.length - HISTORY_LIMIT) : 0; },
    types() { return TICKET_TYPES; },
    quickAddTypes() { return this.ticket ? (CHILD_ALLOWED[this.ticket.type] || []) : []; },
  },
  watch: {
    ticketKey: {
      immediate: true,
      handler(key) {
        if (key) this.load(key, true);
        else { this.ticket = null; this.ctx = null; }
      },
    },
  },
  methods: {
    i18nGet, typeMeta, typeLabel, renderDescription,

    milestoneChoices(currentId) { return milestoneChoicesFor(this.ctx, currentId); },

    // ---- history ----
    historyUser(row) { return (this.ctx.users || []).find((u) => u.id === row.user_id) || null; },
    historyField(row) {
      const key = "history.field." + row.field_changed;
      const text = i18nGet(key);
      return text === key ? row.field_changed : text;
    },
    historyValue(row, value) {
      if (value === null || value === undefined || value === "") return "—";
      if (row.field_changed === "assignee_id" || row.field_changed === "tester_id") {
        const u = (this.ctx.users || []).find((x) => String(x.id) === String(value));
        return u ? u.full_name : "—";
      }
      return value;
    },
    historyDate(value) {
      if (!value) return "";
      const iso = /(Z|[+-]\d\d:?\d\d)$/.test(value) ? value : value + "Z";   // the server stores UTC
      const d = new Date(iso);
      return isNaN(d) ? "" : d.toLocaleString([], { hour12: false, dateStyle: "short", timeStyle: "short" });
    },

    canEdit(ticket) {
      const me = this.ctx && this.ctx.me;
      if (!me) return false;
      if (this.ctx.role === "admin" || this.ctx.role === "editor") return true;
      if (this.ctx.role === "contributor") {
        const reporterId = ticket.reporter ? ticket.reporter.id : ticket.reporter_id;
        const assigneeId = ticket.assignee ? ticket.assignee.id : ticket.assignee_id;
        const testerId = ticket.tester ? ticket.tester.id : ticket.tester_id;
        return [reporterId, assigneeId, testerId].includes(me.id);
      }
      return false;   // reporter: create only
    },
    canDelete() { return !!this.ctx && this.ctx.role === "admin"; },

    toForm(ticket) {
      return {
        id: ticket.id, key: ticket.key, title: ticket.title, description: ticket.description || "",
        type: ticket.type, column_id: ticket.column_id,
        parent_id: ticket.parent_id ?? null, milestone_id: ticket.milestone_id ?? null,
        ancestors: ticket.ancestors || [],
        assignee_id: ticket.assignee ? ticket.assignee.id : null,
        tester_id: ticket.tester ? ticket.tester.id : null,
        reporter_id: ticket.reporter ? ticket.reporter.id : null,
        reporter: ticket.reporter || null,
        reporter_name: ticket.reporter ? ticket.reporter.full_name : "—",
        attachments: [...(ticket.attachments || [])],
        history: [...(ticket.history || [])],
        tag_ids: (ticket.tags || []).map((t) => t.id),
        component_ids: (ticket.components || []).map((c) => c.id),
        new_tags: [], new_components: [],
      };
    },

    async load(key, fresh = false) {
      this.error = "";
      try {
        if (fresh || !this.ctx) this.ctx = await loadTicketContext(this.projectId);
        const ticket = await API.ticketByKey(key);
        this.ticket = this.toForm(ticket);
        this.descEditing = false;     // the description always opens locked
        this.quickAdd = { type: this.quickAddTypes[0] || null, title: "", assignee_id: null };
        this.quickError = "";
      } catch (err) {
        alert(err.message);
        this.$emit("close");
      }
    },

    // plain click: open the ticket here; Ctrl/Cmd/Shift-click and the middle button keep the browser default (new tab/window)
    onCrumb(e, key) {
      if (e.button !== 0 || e.ctrlKey || e.metaKey || e.shiftKey || e.altKey) return;
      e.preventDefault();
      this.go(key);
    },

    go(key) {                           // breadcrumbs
      if (this.page) location.href = `/ticket.html?key=${encodeURIComponent(key)}`;
      else this.load(key);
    },

    // --- files ---
    pickFiles() { this.$refs.fileInput.click(); },
    onFilesPicked(e) {
      const list = Array.from(e.target.files || []);
      e.target.value = "";
      this.uploadFiles(list);
    },
    onPaste(e) {
      const files = Array.from((e.clipboardData && e.clipboardData.files) || []);
      if (!files.length) return;
      e.preventDefault();
      this.uploadFiles(files);
    },
    onDrop(e) {
      const files = Array.from((e.dataTransfer && e.dataTransfer.files) || []);
      if (files.length) this.uploadFiles(files);
    },
    async uploadFiles(files) {
      if (!files.length) return;
      this.error = "";
      this.uploading = true;
      try {
        for (const file of files) {
          const att = await API.uploadAttachment(this.projectId, this.ticket.id, file);
          this.ticket.attachments.push(att);
          const kind = mediaKind(att);
          if (this.descEditing && (kind === "image" || kind === "video")) this.insertIntoDescription(mediaToken(att));
        }
      } catch (err) {
        this.error = err.message;
      } finally {
        this.uploading = false;
      }
    },
    insertIntoDescription(token) {
      const textarea = this.$refs.editDesc;
      const { text, cursor } = insertAtCursor(textarea, this.ticket.description || "", token);
      this.ticket.description = text;
      this.$nextTick(() => { if (textarea) { textarea.focus(); textarea.setSelectionRange(cursor, cursor); } });
    },
    async removeAttachment(att) {
      try {
        await API.deleteAttachment(att.id);
        this.ticket.attachments = this.ticket.attachments.filter((a) => a.id !== att.id);
        this.ticket.description = stripMediaToken(this.ticket.description, att.url);
      } catch (err) {
        this.error = err.message;
      }
    },
    // a click on the locked description starts editing
    onDescClick(e) {
      if (!this.canEdit(this.ticket)) return;
      if (e.target.closest("a, video")) return;
      this.descEditing = true;
      this.$nextTick(() => {
        const ta = this.$refs.editDesc;
        if (ta) { ta.focus(); ta.setSelectionRange(ta.value.length, ta.value.length); }
      });
    },

    async submitQuickAdd() {
      this.quickError = "";
      if (!this.quickAdd.type || !this.quickAdd.title.trim()) return;
      try {
        await API.createTicket(this.projectId, {
          title: this.quickAdd.title.trim(),
          type: this.quickAdd.type,
          parent_id: this.ticket.id,
          assignee_id: this.quickAdd.assignee_id || null,
        });
        this.$emit("changed", { action: "subtask", id: this.ticket.id });
        await this.load(this.ticket.key);      // fresh ancestors / children
      } catch (err) {
        this.quickError = err.message;
      }
    },

    async saveEdit() {
      this.error = "";
      const t = this.ticket;
      try {
        await API.updateTicket(t.id, {
          title: t.title.trim(), description: t.description === "" ? null : t.description, type: t.type,
          column_id: t.column_id, milestone_id: t.milestone_id,
          assignee_id: t.assignee_id, tester_id: t.tester_id,
          tag_ids: t.tag_ids, component_ids: t.component_ids,
          new_tags: t.new_tags, new_components: t.new_components,
        });
        this.$emit("changed", { action: "saved", id: t.id });
        if (this.page) {                       // the page stays open: show the saved ticket again
          await this.load(this.ticket.key);
          this.savedOk = true;
          setTimeout(() => { this.savedOk = false; }, 2500);
        } else {
          this.$emit("close");
        }
      } catch (err) {
        this.error = err.message;
      }
    },

    async deleteCurrent() {
      if (!confirm(i18nGet("dash.settings.delete_confirm"))) return;
      const id = this.ticket.id;
      try {
        await API.deleteTicket(id);
        this.$emit("changed", { action: "deleted", id });
        this.$emit("close");
      } catch (err) {
        this.error = err.message;
      }
    },
  },
  updated() { applyI18n(); },
  template: `
  <div :class="page ? 'tk-page-wrap' : ['modal-backdrop', { open: ticket && ctx }]" @click.self="!page && $emit('close')">
    <div :class="page ? 'card tk-page-card' : 'modal modal-wide modal-ticket'" v-if="ticket && ctx">
      <button class="modal-close" v-if="!page" @click="$emit('close')" aria-label="Close">✕</button>

      <!-- Хлібні крихти: TP-5/TP-6, все клікабельне -->
      <div class="row crumb-row" style="margin-bottom: 14px; flex-wrap: wrap;">
        <span class="ticket-icon" :title="typeLabel(ticket.type)">{{ typeMeta(ticket.type).icon }}</span>
        <template v-for="(a, i) in ticket.ancestors" :key="a.id">
          <a class="crumb" :href="'/ticket.html?key=' + encodeURIComponent(a.key)"
             :data-testid="'crumb-' + a.key" @click="onCrumb($event, a.key)">{{ a.key }}</a>
          <span class="crumb-sep">/</span>
        </template>
        <!-- the current key is a real link to the ticket page (it can be copied or opened in a new tab) -->
        <a class="crumb self" data-testid="ticket-link"
           :href="'/ticket.html?key=' + encodeURIComponent(ticket.key)"
           :title="i18nGet('ticket.open_page')" @click="page && $event.preventDefault()">{{ ticket.key }}</a>
      </div>

      <form @submit.prevent="saveEdit" class="tk-form">
        <div class="tk-grid">
          <!-- ===== LEFT: what you read and write ===== -->
          <div class="tk-main">
            <div class="field">
              <label data-i18n="ticket.title"></label>
              <input class="input" v-model="ticket.title" required maxlength="200" :disabled="!canEdit(ticket)">
            </div>

            <div class="field">
              <label data-i18n="ticket.description"></label>

              <!-- TP-7: the description is locked by default; click it to edit -->
              <div v-if="!descEditing" class="desc-view" :class="{ editable: canEdit(ticket), locked: !canEdit(ticket) }"
                   :title="canEdit(ticket) ? i18nGet('ticket.desc_edit_hint') : ''"
                   @click="onDescClick">
                <span v-if="!ticket.description" class="desc-empty">
                  {{ canEdit(ticket) ? i18nGet('ticket.desc_placeholder') : '—' }}
                </span>
                <div v-else v-html="renderDescription(ticket.description)"></div>
              </div>
              <textarea v-else class="input" ref="editDesc" v-model="ticket.description" rows="8"
                        :placeholder="i18nGet('ticket.desc_textarea')"
                        @paste="onPaste($event)" @dragover.prevent @drop.prevent="onDrop($event)"></textarea>

              <div class="attach-bar" v-if="canEdit(ticket)">
                <button type="button" class="btn btn-soft btn-sm" :disabled="uploading" @click="pickFiles()">
                  {{ uploading ? i18nGet('ticket.uploading') : i18nGet('ticket.attach') }}
                </button>
                <span class="muted" v-if="!descEditing">{{ i18nGet('ticket.attach_hint') }}</span>
              </div>
              <div class="muted" style="font-size: 12.5px; margin-top: 10px;" v-if="ticket.attachments.length">
                {{ i18nGet('ticket.attachments') }}: {{ ticket.attachments.length }}
              </div>
              <attachment-grid :items="ticket.attachments" :removable="canEdit(ticket)"
                               @remove="removeAttachment($event)"></attachment-grid>
            </div>

            <!-- quick subtask: type | title | assignee (Enter must not save the ticket) -->
            <div v-if="canEdit(ticket) && quickAddTypes.length" class="quick-add-box" data-testid="quick-subtask">
              <div class="muted" style="font-size: 13px; font-weight: 600; margin-bottom: 8px;"
                   data-i18n="ticket.quick_subtask"></div>
              <div class="quick-add-row">
                <select class="input" v-model="quickAdd.type" style="flex: 0 0 auto; width: 150px;">
                  <option v-for="type in quickAddTypes" :key="type" :value="type">
                    {{ typeMeta(type).icon }} {{ typeLabel(type) }}
                  </option>
                </select>
                <input class="input" v-model="quickAdd.title" :placeholder="i18nGet('ticket.title')"
                       @keydown.enter.prevent="submitQuickAdd" style="flex: 1; min-width: 120px;">
                <user-select v-model="quickAdd.assignee_id" :users="ctx.users"
                             :placeholder="i18nGet('ticket.assignee')"></user-select>
                <button type="button" class="btn btn-soft btn-sm" @click="submitQuickAdd" title="＋">＋</button>
              </div>
              <div class="form-error" v-if="quickError">{{ quickError }}</div>
            </div>

            <!-- history of changes, newest first -->
            <section class="tk-history" data-testid="ticket-history">
              <h3 class="tk-history-title">{{ i18nGet('ticket.history') }}</h3>
              <div class="muted" v-if="!historyRows.length">{{ i18nGet('history.empty') }}</div>
              <ul class="tk-history-list" v-else>
                <li v-for="h in historyRows" :key="h.id" data-testid="history-row">
                  <span class="tk-h-who">{{ historyUser(h) ? historyUser(h).full_name : '—' }}</span>
                  <span class="tk-h-what">
                    <b>{{ historyField(h) }}</b>
                    <template v-if="h.field_changed === 'description'">: {{ i18nGet('history.changed') }}</template>
                    <template v-else>: {{ historyValue(h, h.old_value) }} → {{ historyValue(h, h.new_value) }}</template>
                  </span>
                  <span class="muted tk-h-when">{{ historyDate(h.created_at) }}</span>
                </li>
              </ul>
              <button type="button" class="btn btn-ghost btn-sm" v-if="historyHidden && !historyAll"
                      data-testid="history-more" @click="historyAll = true">{{ i18nGet('history.show_all') }} ({{ historyHidden }})</button>
            </section>
          </div>

          <!-- ===== RIGHT: fields ===== -->
          <aside class="tk-side" data-testid="ticket-fields">
            <div class="field">
              <label data-i18n="ticket.type"></label>
              <select class="input" v-model="ticket.type" :disabled="!canEdit(ticket)">
                <option v-for="type in types" :key="type" :value="type">
                  {{ typeMeta(type).icon }} {{ typeLabel(type) }}
                </option>
              </select>
            </div>
            <div class="field">
              <label data-i18n="ticket.status"></label>
              <select class="input" v-model="ticket.column_id" :disabled="!canEdit(ticket)">
                <option v-for="col in ctx.columns" :key="col.id" :value="col.id">{{ col.name }}</option>
              </select>
            </div>
            <div class="field">
              <label>{{ i18nGet('ticket.milestone') }}</label>
              <search-select v-model="ticket.milestone_id" :options="milestoneChoices(ticket.milestone_id)"
                             :disabled="!canEdit(ticket)"
                             :placeholder="i18nGet('ticket.no_milestone')" testid="edit-milestone"></search-select>
            </div>
            <div class="field">
              <label data-i18n="ticket.assignee"></label>
              <user-select v-model="ticket.assignee_id" :users="ctx.users"
                           :disabled="!canEdit(ticket)"></user-select>
            </div>
            <div class="field">
              <label data-i18n="ticket.tester"></label>
              <user-select v-model="ticket.tester_id" :users="ctx.users" stub="🧪"
                           :disabled="!canEdit(ticket)"></user-select>
            </div>
            <div class="field">
              <label data-i18n="ticket.author"></label>
              <user-select :model-value="ticket.reporter_id" :users="ticket.reporter ? [ticket.reporter] : []"
                           disabled></user-select>
            </div>
            <div class="field">
              <label data-i18n="ticket.tags"></label>
              <label-picker v-model="ticket.tag_ids" v-model:pending="ticket.new_tags"
                            :options="ctx.tags" :name-max="30" :disabled="!canEdit(ticket)"
                            :placeholder="i18nGet('ticket.tags_placeholder')" testid="edit-tags"></label-picker>
            </div>
            <div class="field">
              <label data-i18n="ticket.components"></label>
              <label-picker v-model="ticket.component_ids" v-model:pending="ticket.new_components"
                            :options="ctx.components" :name-max="50" :disabled="!canEdit(ticket)"
                            :placeholder="i18nGet('ticket.components_placeholder')" testid="edit-components"></label-picker>
            </div>
            <div class="muted" style="font-size: 12.5px;" v-if="!canEdit(ticket)">
              🔒 <span data-i18n="ticket.readonly"></span>
            </div>
          </aside>
        </div>

        <div class="form-error" v-if="error">{{ error }}</div>
        <div class="row tk-footer" v-if="canEdit(ticket)">
          <button v-if="canDelete()" type="button" class="btn btn-danger" @click="deleteCurrent"
                  :title="i18nGet('common.delete')">🗑 <span data-i18n="common.delete"></span></button>
          <span class="spacer"></span>
          <span class="form-ok" v-if="savedOk" data-testid="ticket-saved">✓ {{ i18nGet('ticket.saved') }}</span>
          <button type="submit" class="btn btn-primary" data-i18n="common.save"></button>
        </div>
      </form>
    </div>
    <input type="file" ref="fileInput" multiple style="display: none;" @change="onFilesPicked">
</div>
  `,
};

function registerTicketDialogs(app) {
  app.component("TicketCreateDialog", TicketCreateDialog);
  app.component("TicketEditDialog", TicketEditDialog);
  return app;
}

// For pages that are not built with Vue (the Roadmap): a small Vue app that holds only the dialogs.
// Returns { openCreate(defaults), openEdit(key), onChange(fn) }.
function mountTicketHost(projectId) {
  const handlers = [];
  const root = document.createElement("div");
  document.body.appendChild(root);
  const host = Vue.createApp({
    data() { return { projectId, showCreate: false, defaults: {}, editKey: null }; },
    methods: {
      notify(payload) { handlers.forEach((fn) => fn(payload)); },
    },
    template: `
      <ticket-create-dialog :project-id="projectId" :open="showCreate" :defaults="defaults"
                            @close="showCreate = false" @created="notify({ action: 'created', id: $event.id })">
      </ticket-create-dialog>
      <ticket-edit-dialog :project-id="projectId" :ticket-key="editKey"
                          @close="editKey = null" @changed="notify($event)"></ticket-edit-dialog>`,
  });
  registerSharedComponents(host);
  registerTicketDialogs(host);
  const vm = host.mount(root);
  return {
    openCreate(defaults = {}) { vm.defaults = defaults; vm.showCreate = true; },
    openEdit(key) { vm.editKey = key; },
    onChange(fn) { handlers.push(fn); },
  };
}