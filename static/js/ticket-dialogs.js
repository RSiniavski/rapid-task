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
  if (window.RTMarkdown) RTMarkdown.setMembers(members);    // mention chips: who is still in the project
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
    richOk() { return !!(window.RTRich && RTRich.ready()); },      // WYSIWYG editor; else the plain textarea
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
    // inline = the files came from a paste or drop into the description: every file gets a place in the text
    async uploadFiles(files, inline = false) {
      if (!files.length) return;
      this.error = "";
      this.uploading = true;
      try {
        for (const file of files) {
          const att = await API.uploadAttachment(this.projectId, null, file);
          this.attachments.push(att);
          const kind = mediaKind(att);
          if (inline || kind === "image" || kind === "video") this.insertIntoDescription(mediaToken(att));
        }
      } catch (err) {
        this.error = err.message;
      } finally {
        this.uploading = false;
      }
    },
    insertIntoDescription(token) {
      const textarea = this.$refs.createDesc;
      if (this.richOk) { textarea.insertToken(token); return; }
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
              <rich-editor v-if="richOk" ref="createDesc" v-model="form.description" :members="ctx.users || []"
                           :placeholder="i18nGet('ticket.desc_textarea')" @files="uploadFiles($event, true)"></rich-editor>
              <textarea v-else class="input" ref="createDesc" v-model="form.description" rows="8"
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

// ---------------------------------------------------------------- Activity: comments + history
// One section with a drop-down: Comments (sortable) or History (with the text diff of description changes).
function lineDiff(oldText, newText) {
  const a = oldText ? oldText.split("\n") : [], b = newText ? newText.split("\n") : [];   // no text = no lines
  const n = a.length, m = b.length;
  const dp = Array.from({ length: n + 1 }, () => new Array(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--)
    dp[i][j] = a[i] === b[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
  const out = [];
  let i = 0, j = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) { out.push({ t: "same", text: a[i] }); i++; j++; }
    else if (dp[i + 1][j] >= dp[i][j + 1]) { out.push({ t: "del", text: a[i] }); i++; }
    else { out.push({ t: "add", text: b[j] }); j++; }
  }
  while (i < n) out.push({ t: "del", text: a[i++] });
  while (j < m) out.push({ t: "add", text: b[j++] });
  return out;
}

const TicketActivity = {
  name: "TicketActivity",
  props: {
    ticketId: { type: Number, required: true },
    projectId: { type: Number, default: null },
    history: { type: Array, default: () => [] },
    users: { type: Array, default: () => [] },
    me: { type: Object, default: null },
    role: { type: String, default: null },
  },
  emits: ["changed", "attached"],          // changed: a comment was added/edited/deleted (new history row); attached: an image was added to the ticket
  data() {
    let view = "comments", order = "asc";
    try {
      view = localStorage.getItem("rt_activity_view") === "history" ? "history" : "comments";
      order = localStorage.getItem("rt_comment_order") === "desc" ? "desc" : "asc";
    } catch (e) { /* no storage: defaults */ }
    return {
      view, order, comments: [], loaded: false, error: "", sending: false, uploading: false,
      newBody: "", editId: null, editBody: "", historyAll: false, openDiffs: {},
    };
  },
  computed: {
    richOk() { return !!(window.RTRich && RTRich.ready()); },
    isAdmin() { return this.role === "admin"; },
    historyRows() {
      const rows = [...this.history].sort((a, b) => b.id - a.id);
      return this.historyAll ? rows : rows.slice(0, HISTORY_LIMIT);
    },
    historyHidden() { return Math.max(0, this.history.length - HISTORY_LIMIT); },
  },
  watch: {
    view(v) { try { localStorage.setItem("rt_activity_view", v); } catch (e) { /* ignore */ } },
    order(v) {
      try { localStorage.setItem("rt_comment_order", v); } catch (e) { /* ignore */ }
      this.loadComments();
    },
    ticketId: { immediate: true, handler() { this.loadComments(); } },
  },
  mounted() { this.hydrate(); },
  updated() { this.hydrate(); },
  methods: {
    i18nGet, renderDescription,
    hydrate() {
      if (!window.RTMarkdown) return;
      this.$el.querySelectorAll(".cm-body").forEach((el) => RTMarkdown.hydrate(el));
    },
    userOf(id) { return this.users.find((u) => u.id === id) || null; },
    nameOf(id) { const u = this.userOf(id); return u ? userName(u) : "—"; },
    when(value) {
      if (!value) return "";
      const iso = /(Z|[+-]\d\d:?\d\d)$/.test(value) ? value : value + "Z";   // the server stores UTC
      const d = new Date(iso);
      return isNaN(d) ? "" : d.toLocaleString([], { hour12: false, dateStyle: "short", timeStyle: "short" });
    },

    // ---- comments ----
    async loadComments() {
      this.error = "";
      try {
        this.comments = await API.comments(this.ticketId, this.order);
        this.loaded = true;
      } catch (err) { this.error = err.message; }
    },
    canEditComment(c) { return !!this.me && c.author_id === this.me.id; },
    canDeleteComment(c) { return !!this.me && (c.author_id === this.me.id || this.isAdmin); },
    blank(text) { return !text || !text.trim(); },
    async send() {
      if (this.blank(this.newBody) || this.sending) return;
      this.sending = true; this.error = "";
      try {
        await API.addComment(this.ticketId, this.newBody);
        this.newBody = "";
        await this.loadComments();
        this.$emit("changed");
      } catch (err) { this.error = err.message; }
      this.sending = false;
    },
    // files pasted or dropped into a comment editor: stored as ticket attachments, shown inside the text
    // (an image or a video is shown, any other file is a link)
    async addFiles(files, editor) {
      this.error = "";
      if (!files.length || this.uploading) return;
      this.uploading = true;
      try {
        for (const file of files) {
          const att = await API.uploadAttachment(this.projectId, this.ticketId, file, "comment");
          this.$emit("attached", att);
          const found = this.$refs[editor];
          const box = Array.isArray(found) ? found[0] : found;      // a ref inside v-for is a list
          if (box) box.insertToken(mediaToken(att));
        }
      } catch (err) { this.error = err.message; }
      this.uploading = false;
    },
    startEdit(c) { this.editId = c.id; this.editBody = c.body; },
    cancelEdit() { this.editId = null; this.editBody = ""; },
    async saveEdit(c) {
      if (this.blank(this.editBody)) return;
      this.error = "";
      try {
        await API.editComment(c.id, this.editBody);
        this.cancelEdit();
        await this.loadComments();
        this.$emit("changed");
      } catch (err) { this.error = err.message; }
    },
    async remove(c) {
      if (!window.confirm(i18nGet("comment.delete_confirm"))) return;
      this.error = "";
      try {
        await API.deleteComment(c.id);
        await this.loadComments();
        this.$emit("changed");
      } catch (err) { this.error = err.message; }
    },
    onEditorKey(e, fn) {                      // Ctrl/Cmd+Enter sends
      if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) { e.preventDefault(); fn(); }
    },

    // ---- history ----
    historyField(row) {
      const key = "history.field." + row.field_changed;
      const text = i18nGet(key);
      return text === key ? row.field_changed : text;
    },
    isCreated(h) { return h.field_changed === "column" && (h.old_value === null || h.old_value === undefined); },
    kindOf(h) {
      const f = h.field_changed;
      if (f === "description") return "description";
      if (f.startsWith("comment_")) return "comment";
      if (f.startsWith("attachment_")) return "file";
      if (f.startsWith("subticket_")) return "sub";
      if (this.isCreated(h)) return "created";
      return "field";
    },
    historyValue(row, value) {
      if (value === null || value === undefined || value === "") return "—";
      if (row.field_changed === "assignee_id" || row.field_changed === "tester_id") return this.nameOf(Number(value));
      return value;
    },
    diffOf(h) { return lineDiff(h.old_value, h.new_value); },
    toggleDiff(h) { this.openDiffs = { ...this.openDiffs, [h.id]: !this.openDiffs[h.id] }; },
  },
  template: `
  <section class="tk-activity" data-testid="ticket-activity">
    <div class="tk-act-head">
      <select class="input tk-act-select" v-model="view" data-testid="activity-view" :aria-label="i18nGet('activity.view')">
        <option value="comments">{{ i18nGet('activity.comments') }} ({{ comments.length }})</option>
        <option value="history">{{ i18nGet('activity.history') }} ({{ history.length }})</option>
      </select>
      <select class="input tk-act-select" v-if="view === 'comments'" v-model="order" data-testid="comment-order"
              :aria-label="i18nGet('comment.order')">
        <option value="asc">{{ i18nGet('comment.order_asc') }}</option>
        <option value="desc">{{ i18nGet('comment.order_desc') }}</option>
      </select>
    </div>

    <!-- ===== comments ===== -->
    <div v-if="view === 'comments'" class="tk-comments" data-testid="ticket-comments">
      <div class="form-error" v-if="error" data-testid="comment-error">{{ error }}</div>
      <div class="tk-cm-new" @keydown="onEditorKey($event, send)">
        <rich-editor v-if="richOk" ref="newEditor" v-model="newBody" testid="comment-editor" :members="users"
                     :placeholder="i18nGet('comment.placeholder')" @files="addFiles($event, 'newEditor')"></rich-editor>
        <textarea v-else class="input" rows="3" v-model="newBody" data-testid="comment-editor"
                  :placeholder="i18nGet('comment.placeholder')"></textarea>
        <div class="tk-cm-buttons">
          <span class="muted tk-cm-uploading" v-if="uploading" data-testid="comment-uploading">{{ i18nGet('comment.uploading') }}</span>
          <button type="button" class="btn btn-primary btn-sm" data-testid="comment-send"
                  :disabled="blank(newBody) || sending || uploading" @click="send">{{ i18nGet('comment.add') }}</button>
        </div>
      </div>
      <div class="tk-cm-list">
        <div class="muted" v-if="loaded && !comments.length" data-testid="comments-empty">{{ i18nGet('comment.empty') }}</div>
        <article class="tk-cm" v-for="c in comments" :key="c.id" data-testid="comment" :data-comment-id="c.id">
          <user-avatar :user="userOf(c.author_id)" :size="28"></user-avatar>
          <div class="tk-cm-main">
            <div class="tk-cm-meta">
              <b data-testid="comment-author">{{ nameOf(c.author_id) }}</b>
              <span class="muted">{{ when(c.created_at) }}</span>
              <span class="muted" v-if="c.updated_at" data-testid="comment-edited">· {{ i18nGet('comment.edited') }}</span>
              <span class="tk-cm-actions" v-if="editId !== c.id">
                <button type="button" class="btn btn-ghost btn-sm" v-if="canEditComment(c)" data-testid="comment-edit"
                        @click="startEdit(c)">{{ i18nGet('comment.edit') }}</button>
                <button type="button" class="btn btn-ghost btn-sm" v-if="canDeleteComment(c)" data-testid="comment-delete"
                        @click="remove(c)">{{ i18nGet('common.delete') }}</button>
              </span>
            </div>
            <div v-if="editId === c.id" @keydown="onEditorKey($event, () => saveEdit(c))">
              <rich-editor v-if="richOk" ref="editEditor" v-model="editBody" autofocus testid="comment-edit-editor" :members="users"
                           @files="addFiles($event, 'editEditor')"></rich-editor>
              <textarea v-else class="input" rows="4" v-model="editBody" data-testid="comment-edit-editor"></textarea>
              <div class="tk-cm-buttons">
                <button type="button" class="btn btn-primary btn-sm" data-testid="comment-edit-save"
                        :disabled="blank(editBody) || uploading" @click="saveEdit(c)">{{ i18nGet('common.save') }}</button>
                <button type="button" class="btn btn-ghost btn-sm" @click="cancelEdit">{{ i18nGet('common.cancel') }}</button>
              </div>
            </div>
            <div v-else class="cm-body md" data-testid="comment-body" v-html="renderDescription(c.body)"></div>
          </div>
        </article>
      </div>
    </div>

    <!-- ===== history, newest first ===== -->
    <div v-else class="tk-history" data-testid="ticket-history">
      <div class="muted" v-if="!historyRows.length">{{ i18nGet('history.empty') }}</div>
      <ul class="tk-history-list" v-else>
        <li v-for="h in historyRows" :key="h.id" data-testid="history-row">
          <span class="tk-h-who">{{ nameOf(h.user_id) }}</span>
          <span class="tk-h-what">
            <template v-if="kindOf(h) === 'description'">
              <b>{{ historyField(h) }}</b>: {{ i18nGet('history.changed') }}
              <button type="button" class="btn btn-ghost btn-sm tk-h-diffbtn" data-testid="history-diff-toggle"
                      @click="toggleDiff(h)">{{ openDiffs[h.id] ? i18nGet('history.hide_diff') : i18nGet('history.show_diff') }}</button>
              <div class="tk-diff" v-if="openDiffs[h.id]" data-testid="history-diff">
                <div v-for="(l, i) in diffOf(h)" :key="i" class="tk-diff-line" :class="'is-' + l.t">
                  <span class="tk-diff-mark">{{ l.t === 'add' ? '+' : l.t === 'del' ? '−' : ' ' }}</span>{{ l.text }}
                </div>
              </div>
            </template>
            <template v-else-if="kindOf(h) === 'comment'"><b>{{ historyField(h) }}</b></template>
            <template v-else-if="kindOf(h) === 'file'">
              <b>{{ historyField(h) }}</b>: {{ h.new_value || h.old_value }}
            </template>
            <template v-else-if="kindOf(h) === 'sub'">
              <b>{{ historyField(h) }}</b>:
              <a :href="'/ticket.html?key=' + encodeURIComponent(h.new_value || h.old_value)">{{ h.new_value || h.old_value }}</a>
            </template>
            <template v-else-if="kindOf(h) === 'created'">
              <b>{{ i18nGet('history.created') }}</b> ({{ historyField(h) }}: {{ h.new_value }})
            </template>
            <template v-else>
              <b>{{ historyField(h) }}</b>: {{ historyValue(h, h.old_value) }} → {{ historyValue(h, h.new_value) }}
            </template>
          </span>
          <span class="muted tk-h-when">{{ when(h.created_at) }}</span>
        </li>
      </ul>
      <button type="button" class="btn btn-ghost btn-sm" v-if="historyHidden && !historyAll"
              data-testid="history-more" @click="historyAll = true">{{ i18nGet('history.show_all') }} ({{ historyHidden }})</button>
    </div>
  </section>
  `,
};

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
      savedOk: false,
    };
  },
  computed: {
    richOk() { return !!(window.RTRich && RTRich.ready()); },      // WYSIWYG editor; else the plain textarea
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

    // the history changed on the server (a comment was written): load only the history rows
    onCommentImage(att) {                      // a file from a comment is a ticket attachment too
      if (!this.ticket.attachments.some((a) => a.id === att.id)) this.ticket.attachments.push(att);
      this.reloadHistory();
    },
    async reloadHistory() {
      try {
        const fresh = await API.ticketByKey(this.ticket.key);
        this.ticket.history = [...(fresh.history || [])];
      } catch (err) { /* the old rows stay */ }
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
        reporter_name: ticket.reporter ? userName(ticket.reporter) : "—",
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
    // inline = the files came from a paste or drop into the description: every file gets a place in the text
    async uploadFiles(files, inline = false) {
      if (!files.length) return;
      this.error = "";
      this.uploading = true;
      try {
        for (const file of files) {
          const att = await API.uploadAttachment(this.projectId, this.ticket.id, file);
          this.ticket.attachments.push(att);
          const kind = mediaKind(att);
          if (this.descEditing && (inline || kind === "image" || kind === "video")) this.insertIntoDescription(mediaToken(att));
        }
      } catch (err) {
        this.error = err.message;
      } finally {
        this.uploading = false;
      }
    },
    insertIntoDescription(token) {
      const textarea = this.$refs.editDesc;
      if (this.richOk) { textarea.insertToken(token); return; }
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
      if (e.target.closest("a, video, input")) return;
      this.descEditing = true;
      this.$nextTick(() => {
        const ta = this.$refs.editDesc;
        if (ta && this.richOk) ta.focus(true);
        else if (ta) { ta.focus(); ta.setSelectionRange(ta.value.length, ta.value.length); }
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
  updated() {
    applyI18n();
    if (window.RTMarkdown) RTMarkdown.hydrate(this.$refs.descView);   // ticket titles in KEY-N links
  },
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
              <div v-if="!descEditing" class="desc-view md" ref="descView" :class="{ editable: canEdit(ticket), locked: !canEdit(ticket) }"
                   :title="canEdit(ticket) ? i18nGet('ticket.desc_edit_hint') : ''"
                   @click="onDescClick">
                <span v-if="!ticket.description" class="desc-empty">
                  {{ canEdit(ticket) ? i18nGet('ticket.desc_placeholder') : '—' }}
                </span>
                <div v-else v-html="renderDescription(ticket.description)"></div>
              </div>
              <rich-editor v-else-if="richOk" ref="editDesc" v-model="ticket.description" autofocus :members="ctx.users || []"
                           :placeholder="i18nGet('ticket.desc_textarea')" @files="uploadFiles($event, true)"></rich-editor>
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

            <!-- comments / history -->
            <ticket-activity :ticket-id="ticket.id" :project-id="projectId || ticket.project_id" :history="ticket.history"
                             :users="ctx.users || []" :me="ctx.me" :role="ctx.role" @changed="reloadHistory"
                             @attached="onCommentImage"></ticket-activity>
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

/* A click on an image inside a comment shows it big. Esc or a click closes it. */
const RTLightbox = {
  el: null,
  open(src, alt) {
    this.close();
    const box = document.createElement("div");
    box.className = "rt-lightbox";
    box.setAttribute("data-testid", "image-lightbox");
    box.setAttribute("role", "dialog");
    box.setAttribute("aria-modal", "true");
    const img = document.createElement("img");
    img.src = src;
    img.alt = alt || "";
    img.setAttribute("data-testid", "image-lightbox-img");
    const close = document.createElement("button");
    close.type = "button";
    close.className = "rt-lightbox-close";
    close.textContent = "×";
    close.setAttribute("aria-label", i18nGet("image.close"));
    close.setAttribute("data-testid", "image-lightbox-close");
    box.append(img, close);
    box.addEventListener("click", () => this.close());
    document.body.appendChild(box);
    this.el = box;
  },
  close() { if (this.el) { this.el.remove(); this.el = null; } },
};
document.addEventListener("click", (e) => {
  const img = e.target && e.target.closest ? e.target.closest(".cm-body img.desc-media") : null;
  if (img) { e.preventDefault(); RTLightbox.open(img.getAttribute("src"), img.getAttribute("alt")); }
});
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape" && RTLightbox.el) { e.stopImmediatePropagation(); e.preventDefault(); RTLightbox.close(); }
}, true);

function registerTicketDialogs(app) {
  app.component("TicketCreateDialog", TicketCreateDialog);
  app.component("TicketEditDialog", TicketEditDialog);
  app.component("TicketActivity", TicketActivity);
  if (typeof RichEditor !== "undefined") app.component("RichEditor", RichEditor);
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