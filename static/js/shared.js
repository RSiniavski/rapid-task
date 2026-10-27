/* ============================================================
   Rapid Task — спільні Vue-компоненти та утиліти (без збірки)
   - UserAvatar  : кругла аватарка або заглушка (TP-12/13)
   - UserSelect  : спадне меню користувачів з аватарками (TP-13)
   - ProfileModal: особистий кабінет (TP-8)
   - renderDescription / attachment helpers (TP-6)
   Підключати після i18n.js та api.js, до сторінкового скрипта.
   ============================================================ */

// ---------- Утиліти для вкладень та опису (TP-6) ----------

const VIDEO_EXT = ["mp4", "webm", "ogv", "mov", "m4v"];
const IMAGE_EXT = ["png", "jpg", "jpeg", "gif", "webp", "bmp", "avif"];

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function fileExt(name) {
  const m = /\.([A-Za-z0-9]{1,10})$/.exec(name || "");
  return m ? m[1].toLowerCase() : "";
}

// вид файлу за вкладенням з API (kind) або за розширенням
function mediaKind(item) {
  if (item.kind) return item.kind;
  const ext = fileExt(item.filename || item.url);
  if (IMAGE_EXT.includes(ext)) return "image";
  if (VIDEO_EXT.includes(ext)) return "video";
  return "file";
}

function formatSize(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

// Токен медіа в тексті опису: ![назва](/uploads/<файл>)
function mediaToken(att) {
  const alt = (att.filename || "file").replace(/[\[\]\n]/g, "");
  return `![${alt}](${att.url})`;
}

// прибрати з тексту опису токени конкретного файлу (після видалення вкладення)
function stripMediaToken(text, url) {
  if (!text) return text;
  const escaped = url.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return text.replace(new RegExp(`\\n?!\\[[^\\]\\n]*\\]\\(${escaped}\\)`, "g"), "");
}

// Безпечний рендер опису: увесь текст екранується, лише токени медіа
// з /uploads/ перетворюються на <img>/<video>/посилання.
function renderDescription(text) {
  if (!text) return "";
  const safe = escapeHtml(text);
  return safe
    .replace(
      /!\[([^\]\n]*)\]\((\/uploads\/[A-Za-z0-9_.-]+)\)/g,
      (_, alt, url) => {
        const ext = fileExt(url);
        if (IMAGE_EXT.includes(ext)) {
          return `<img class="desc-media" src="${url}" alt="${alt}" loading="lazy">`;
        }
        if (VIDEO_EXT.includes(ext)) {
          return `<video class="desc-media" src="${url}" controls preload="metadata"></video>`;
        }
        return `<a class="desc-file" href="${url}" target="_blank" rel="noopener">📎 ${alt || url}</a>`;
      }
    )
    .replace(/\n/g, "<br>");
}

// вставка тексту в позицію курсора textarea; повертає новий текст
function insertAtCursor(textarea, value, insert) {
  const start = textarea && typeof textarea.selectionStart === "number"
    ? textarea.selectionStart : value.length;
  const end = textarea && typeof textarea.selectionEnd === "number"
    ? textarea.selectionEnd : value.length;
  const before = value.slice(0, start);
  const after = value.slice(end);
  const pre = before && !before.endsWith("\n") ? "\n" : "";
  const post = after && !after.startsWith("\n") ? "\n" : "";
  return { text: before + pre + insert + post + after, cursor: (before + pre + insert + post).length };
}

// ---------- Компоненти ----------

const UserAvatar = {
  name: "UserAvatar",
  props: {
    user: { type: Object, default: null },
    size: { type: Number, default: 24 },
    stub: { type: String, default: "👤" },
  },
  data() { return { broken: false }; },
  watch: {
    "user.avatar_url"() { this.broken = false; },
  },
  computed: {
    hasImage() { return !!(this.user && this.user.avatar_url) && !this.broken; },
    // "Mike Tyson" -> "MT", "Madonna" -> "M"
    initials() {
      const name = ((this.user && this.user.full_name) || "").trim();
      if (!name) return "";
      const words = name.split(/\s+/).filter(Boolean);
      const first = (w) => Array.from(w)[0] || "";
      const letters = words.length > 1 ? first(words[0]) + first(words[1]) : first(words[0]);
      return letters.toLocaleUpperCase();
    },
    colorClass() {
      const id = this.user && Number.isInteger(this.user.id) ? this.user.id : 0;
      return "avatar-c" + (id % 5);
    },
    boxStyle() {
      const k = !this.hasImage && this.initials ? 0.4 : 0.58;
      return { width: this.size + "px", height: this.size + "px", fontSize: Math.round(this.size * k) + "px" };
    },
    extraClass() {
      if (this.hasImage) return "";
      return this.initials ? "avatar-initials " + this.colorClass : "avatar-stub";
    },
  },
  template: `
    <span class="avatar" :style="boxStyle" :class="extraClass">
      <img v-if="hasImage" :src="user.avatar_url" :alt="user.full_name" @error="broken = true">
      <span v-else class="avatar-glyph">{{ initials || stub }}</span>
    </span>`,
};

const UserSelect = {
  name: "UserSelect",
  components: { UserAvatar },
  props: {
    modelValue: { type: Number, default: null },
    users: { type: Array, default: () => [] },
    disabled: { type: Boolean, default: false },
    stub: { type: String, default: "👤" },
    placeholder: { type: String, default: "—" },
    compact: { type: Boolean, default: false },
  },
  emits: ["update:modelValue"],
  data() { return { open: false, query: "" }; },
  computed: {
    selected() { return this.users.find(u => u.id === this.modelValue) || null; },
    filtered() {
      const q = this.query.trim().toLowerCase();
      if (!q) return this.users;
      return this.users.filter(u => (u.full_name || "").toLowerCase().includes(q)
                                 || (u.position || "").toLowerCase().includes(q));
    },
  },
  methods: {
    t: i18nGet,
    toggle() {
      if (this.disabled) return;
      this.open = !this.open;
      this.query = "";
      if (this.open) this.$nextTick(() => { if (this.$refs.search) this.$refs.search.focus(); });
    },
    pick(id) { this.$emit("update:modelValue", id); this.open = false; this.query = ""; },
    pickFirst() { if (this.filtered.length) this.pick(this.filtered[0].id); },
    onDocClick(e) { if (!this.$el.contains(e.target)) { this.open = false; this.query = ""; } },
  },
  mounted() { document.addEventListener("click", this.onDocClick); },
  beforeUnmount() { document.removeEventListener("click", this.onDocClick); },
  template: `
    <div class="user-select" :class="{ disabled, open, compact }" @keydown.esc="open = false">
      <button type="button" class="us-btn input" :disabled="disabled" @click="toggle"
              aria-haspopup="listbox" :aria-expanded="open">
        <template v-if="selected">
          <user-avatar :user="selected" :size="22" :stub="stub"></user-avatar>
          <span class="us-name">{{ selected.full_name }}</span>
        </template>
        <span v-else class="us-name us-empty">{{ placeholder }}</span>
        <span class="us-caret">▾</span>
      </button>
      <ul v-if="open" class="us-list" role="listbox">
        <li class="us-search">
          <input ref="search" class="input" v-model="query" :placeholder="t('select.search')"
                 autocomplete="off" @keydown.enter.prevent="pickFirst">
        </li>
        <li v-if="!query" class="us-item" :class="{ active: modelValue === null }" @click="pick(null)" role="option">
          <span class="us-name us-empty">{{ placeholder }}</span>
        </li>
        <li v-for="u in filtered" :key="u.id" class="us-item" :class="{ active: u.id === modelValue }"
            @click="pick(u.id)" role="option">
          <user-avatar :user="u" :size="24" :stub="stub"></user-avatar>
          <span class="us-name">{{ u.full_name }}</span>
          <span class="us-sub" v-if="u.position">{{ u.position }}</span>
        </li>
        <li v-if="!filtered.length" class="us-item us-empty">{{ t('select.no_matches') }}</li>
      </ul>
    </div>`,
};

const ProfileModal = {
  name: "ProfileModal",
  components: { UserAvatar },
  props: {
    open: { type: Boolean, default: false },
    user: { type: Object, default: null },
  },
  emits: ["close", "updated"],
  data() {
        return { fullName: "", position: "", error: "", ok: "", busy: false, themeId: null, themes: [], themeLocked: false };
  },
  watch: {
    open(val) {
      if (val && this.user) {
        this.fullName = this.user.full_name || "";
        this.position = this.user.position || "";
        this.error = "";
        this.ok = "";
        this.loadThemes();
        this.themeLocked = ThemeEngine.isLocked();
      }
    },
  },
  methods: {
    t: i18nGet,
        async loadThemes() {
      try {
        this.themes = await API.themes();
        const fallback = this.themes.find((x) => x.key === ThemeEngine.current());
        this.themeId = this.user.theme_id ?? (fallback ? fallback.id : null);
        this.themeLocked = ThemeEngine.isLocked();
      } catch (err) {
        this.error = err.message;
      }
    },
    async onTheme() {
      const theme = this.themes.find((x) => x.id === this.themeId);
      if (!theme) return;
      if (!this.themeLocked) ThemeEngine.use(theme);   // instant change + remember
      try {
        const updated = await API.setMyTheme(theme.id);
        this.$emit("updated", updated);
      } catch (err) {
        this.error = err.message;
      }
    },
        pickThemeFile() { this.$refs.themeFile.click(); },
    async onThemeFile(e) {
      const file = e.target.files && e.target.files[0];
      e.target.value = "";
      if (!file) return;
      this.error = ""; this.ok = "";
      if (file.size > 20000) { this.error = i18nGet("profile.theme_too_big"); return; }
      let parsed;
      try { parsed = JSON.parse(await file.text()); }
      catch (_) { this.error = i18nGet("profile.theme_bad_json"); return; }
      try {
        const created = await API.importTheme(parsed);
        this.themes = await API.themes();
        this.themeId = created.id;
        await this.onTheme();
        this.ok = i18nGet("profile.theme_imported");
      } catch (err) {
        this.error = err.message;
      }
    },
    async exportTheme() {
      this.error = ""; this.ok = "";
      try {
        const data = await API.exportTheme(this.themeId);
        const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
        const a = document.createElement("a");
        a.href = URL.createObjectURL(blob);
        a.download = (data.name || "theme").replace(/[^\w.-]+/g, "_") + ".json";
        a.click();
        URL.revokeObjectURL(a.href);
      } catch (err) {
        this.error = err.message;
      }
    },
    async deleteTheme() {
      const theme = this.themes.find((x) => x.id === this.themeId);
      if (!theme || theme.is_preset) return;
      if (!confirm(i18nGet("profile.theme_delete_confirm"))) return;
      this.error = ""; this.ok = "";
      try {
        await API.deleteTheme(theme.id);
        this.themes = await API.themes();
        const def = this.themes.find((x) => x.key === ThemeEngine.DEFAULT_KEY);
        this.themeId = def ? def.id : null;
        await this.onTheme();                      // switch to the default theme
      } catch (err) {
        this.error = err.message;
      }
    },
    async save() {
      this.error = ""; this.ok = "";
      if (!this.fullName.trim()) { this.error = i18nGet("profile.name_required"); return; }
      this.busy = true;
      try {
        const updated = await API.updateProfile({
          full_name: this.fullName.trim(),
          position: this.position.trim(),
        });
        this.$emit("updated", updated);
        this.ok = i18nGet("profile.saved");
      } catch (err) {
        this.error = err.message;
      } finally {
        this.busy = false;
      }
    },
    pickFile() { this.$refs.file.click(); },
    async onFile(e) {
      const file = e.target.files && e.target.files[0];
      e.target.value = "";
      if (!file) return;
      this.error = ""; this.ok = "";
      this.busy = true;
      try {
        const updated = await API.uploadAvatar(file);
        this.$emit("updated", updated);
      } catch (err) {
        this.error = err.message;
      } finally {
        this.busy = false;
      }
    },
    async removeAvatar() {
      this.error = ""; this.ok = "";
      this.busy = true;
      try {
        const updated = await API.deleteAvatar();
        this.$emit("updated", updated);
      } catch (err) {
        this.error = err.message;
      } finally {
        this.busy = false;
      }
    },
  },
  template: `
    <div class="modal-backdrop" :class="{ open }" @click.self="$emit('close')">
      <div class="modal profile-modal" v-if="open && user" role="dialog" aria-modal="true">
        <button class="modal-close" @click="$emit('close')" aria-label="Close">✕</button>
        <h2 style="font-size: 20px; margin-bottom: 18px;">{{ t('profile.title') }}</h2>

        <div class="profile-avatar-row">
          <user-avatar :user="user" :size="84" stub="👤"></user-avatar>
          <div class="profile-avatar-actions">
            <button type="button" class="btn btn-soft btn-sm" :disabled="busy" @click="pickFile">
              {{ user.avatar_url ? t('profile.avatar_change') : t('profile.avatar_set') }}
            </button>
            <button type="button" class="btn btn-ghost btn-sm" v-if="user.avatar_url"
                    :disabled="busy" @click="removeAvatar">{{ t('profile.avatar_remove') }}</button>
            <div class="muted" style="font-size: 12px;">{{ t('profile.avatar_hint') }}</div>
          </div>
          <input ref="file" type="file" accept="image/png,image/jpeg,image/gif,image/webp"
                 style="display: none;" @change="onFile">
        </div>

        <form @submit.prevent="save">
          <div class="field">
            <label>{{ t('profile.email') }}</label>
            <input class="input" :value="user.email" disabled>
          </div>
          <div class="field">
            <label>{{ t('profile.name') }}</label>
            <input class="input" v-model="fullName" required maxlength="100">
          </div>
          <div class="field">
            <label>{{ t('profile.position') }}</label>
            <input class="input" v-model="position" maxlength="100"
                   :placeholder="t('profile.position_placeholder')">
          </div>
          <div class="field">
            <label>{{ t('profile.theme') }}</label>
            <select class="input" data-testid="theme-select" v-model="themeId" @change="onTheme" :disabled="themeLocked">
              <option v-for="th in themes" :key="th.id" :value="th.id">{{ th.name }}</option>
            </select>
            <div class="row" style="gap: 8px; margin-top: 8px; flex-wrap: wrap;">
              <button type="button" class="btn btn-soft btn-sm" data-testid="theme-import"
                      @click="pickThemeFile">{{ t('profile.theme_import') }}</button>
              <button type="button" class="btn btn-soft btn-sm" data-testid="theme-export"
                      @click="exportTheme" :disabled="themeId === null">{{ t('profile.theme_export') }}</button>
              <button type="button" class="btn btn-soft btn-sm" data-testid="theme-delete"
                      @click="deleteTheme"
                      v-if="themes.find(x => x.id === themeId && !x.is_preset)">{{ t('profile.theme_delete') }}</button>
              <input ref="themeFile" type="file" accept=".json,application/json" hidden
                     data-testid="theme-file" @change="onThemeFile">
            </div>
            <div class="muted" style="font-size: 12.5px; margin-top: 6px;" v-if="themeLocked">{{ t('profile.theme_locked') }}</div>
          </div>
          <div class="form-error" v-if="error">{{ error }}</div>
          <div class="form-ok" v-if="ok">✓ {{ ok }}</div>
          <button type="submit" class="btn btn-primary btn-block" :disabled="busy">{{ t('common.save') }}</button>
        </form>
      </div>
    </div>`,
};


const AttachmentGrid = {
  name: "AttachmentGrid",
  props: {
    items: { type: Array, default: () => [] },
    removable: { type: Boolean, default: false },
  },
  emits: ["remove"],
  methods: {
    kind: mediaKind,
    ext: (item) => fileExt(item.filename) || "file",
    size: formatSize,
    removeLabel: () => i18nGet("ticket.attach_remove"),
  },
  template: `
    <div class="attach-grid" v-if="items.length">
      <div class="attach-thumb" v-for="it in items" :key="it.id" :title="it.filename + ' · ' + size(it.size)">
        <a class="attach-thumb-body" :href="it.url" target="_blank" rel="noopener"
           :download="kind(it) === 'file' ? it.filename : null">
          <img v-if="kind(it) === 'image'" :src="it.url" :alt="it.filename" loading="lazy">
          <template v-else-if="kind(it) === 'video'">
            <video :src="it.url + '#t=0.1'" preload="metadata" muted></video>
            <span class="attach-play">▶ video</span>
          </template>
          <span v-else class="file-ext">{{ ext(it) }}</span>
        </a>
        <div class="attach-thumb-name">{{ it.filename }}</div>
        <button type="button" class="attach-remove" v-if="removable"
                :title="removeLabel()" @click.stop="$emit('remove', it)">✕</button>
      </div>
    </div>`,
};

// Вибір міток (теги / компоненти): чипи + пошук. Нові назви лише "очікують" у формі
// і створюються сервером разом із тікетом.
const LabelPicker = {
  name: "LabelPicker",
  props: {
    modelValue: { type: Array, default: () => [] },     // вибрані id існуючих міток
    pending: { type: Array, default: () => [] },        // нові назви (ще не створені)
    options: { type: Array, default: () => [] },        // [{ id, name }]
    disabled: { type: Boolean, default: false },
    max: { type: Number, default: 10 },
    nameMax: { type: Number, default: 50 },
    placeholder: { type: String, default: "" },
    testid: { type: String, default: "" },
    allowNew: { type: Boolean, default: true },
  },
  emits: ["update:modelValue", "update:pending"],
  data() { return { query: "", open: false }; },
  computed: {
    selected() {
      return this.modelValue.map(id => this.options.find(o => o.id === id)).filter(Boolean);
    },
    total() { return this.modelValue.length + this.pending.length; },
    suggestions() {
      const q = this.query.trim().toLowerCase();
      return this.options
        .filter(o => !this.modelValue.includes(o.id) && (!q || o.name.toLowerCase().includes(q)))
        .slice(0, 8);
    },
    exact() {
      const q = this.query.trim().toLowerCase();
      return q ? this.options.find(o => o.name.toLowerCase() === q) || null : null;
    },
    pendingHas() {
      const q = this.query.trim().toLowerCase();
      return this.pending.some(p => p.toLowerCase() === q);
    },
    canAdd() { return this.allowNew && !!this.query.trim() && !this.exact && !this.pendingHas; },
  },
  methods: {
    t: i18nGet,
    add(option) {
      if (option && !this.modelValue.includes(option.id) && this.total < this.max) {
        this.$emit("update:modelValue", [...this.modelValue, option.id]);
      }
      this.query = "";
    },
    addNew() {
      if (!this.canAdd || this.total >= this.max) return;
      this.$emit("update:pending", [...this.pending, this.query.trim()]);
      this.query = "";
    },
    remove(id) { this.$emit("update:modelValue", this.modelValue.filter(x => x !== id)); },
    removePending(name) { this.$emit("update:pending", this.pending.filter(x => x !== name)); },
    commit() {
      if (this.exact) this.add(this.exact);
      else if (this.pendingHas) this.query = "";
      else this.addNew();
    },
    onDocClick(e) { if (!this.$el.contains(e.target)) this.open = false; },
  },
  mounted() { document.addEventListener("click", this.onDocClick); },
  beforeUnmount() { document.removeEventListener("click", this.onDocClick); },
  template: `
    <div class="label-picker" :class="{ disabled }">
      <div class="lp-box input">
        <span v-for="o in selected" :key="o.id" class="lp-chip">
          {{ o.name }}
          <button type="button" class="lp-x" v-if="!disabled" @click="remove(o.id)"
                  :aria-label="t('labels.remove')">✕</button>
        </span>
        <span v-for="p in pending" :key="'new-' + p" class="lp-chip lp-new" :title="t('labels.new_hint')">
          {{ p }}
          <button type="button" class="lp-x" v-if="!disabled" @click="removePending(p)"
                  :aria-label="t('labels.remove')">✕</button>
        </span>
        <input v-if="!disabled && total < max" class="lp-input" v-model="query"
               :placeholder="total ? '' : placeholder" :maxlength="nameMax"
               :data-testid="testid" autocomplete="off"
               @focus="open = true" @input="open = true"
               @keydown.enter.prevent="commit" @keydown.esc="open = false">
        <span v-if="disabled && !total" class="us-empty">—</span>
      </div>
      <ul v-if="open && !disabled && (suggestions.length || canAdd)" class="lp-list">
        <li v-for="o in suggestions" :key="o.id" @mousedown.prevent="add(o)">{{ o.name }}</li>
        <li v-if="canAdd" class="lp-create" @mousedown.prevent="addNew">
          ＋ {{ t('labels.create') }} “{{ query.trim() }}”
        </li>
      </ul>
    </div>`,
};

// Single choice with search. Selected value is shown as a chip (✕ clears it).
const SearchSelect = {
  name: "SearchSelect",
  props: {
    modelValue: { type: Number, default: null },
    options: { type: Array, default: () => [] },      // [{ id, name, disabled }]
    disabled: { type: Boolean, default: false },
    placeholder: { type: String, default: "" },
    testid: { type: String, default: "" },
  },
  emits: ["update:modelValue"],
  data() { return { query: "", open: false }; },
  computed: {
    selected() { return this.options.find(o => o.id === this.modelValue) || null; },
    filtered() {
      const q = this.query.trim().toLowerCase();
      return this.options.filter(o => !o.disabled && (!q || o.name.toLowerCase().includes(q))).slice(0, 50);
    },
  },
  methods: {
    t: i18nGet,
    pick(o) { this.$emit("update:modelValue", o.id); this.query = ""; this.open = false; },
    clear() {
      this.$emit("update:modelValue", null);
      this.$nextTick(() => { if (this.$refs.input) this.$refs.input.focus(); });
    },
    commit() { if (this.filtered.length) this.pick(this.filtered[0]); },
    onDocClick(e) { if (!this.$el.contains(e.target)) this.open = false; },
  },
  mounted() { document.addEventListener("click", this.onDocClick); },
  beforeUnmount() { document.removeEventListener("click", this.onDocClick); },
  template: `
    <div class="label-picker search-select" :class="{ disabled }">
      <div class="lp-box input">
        <span v-if="selected" class="lp-chip" :data-testid="testid + '-chip'">
          {{ selected.name }}
          <button type="button" class="lp-x" v-if="!disabled" @click="clear"
                  :aria-label="t('labels.remove')">✕</button>
        </span>
        <input v-else-if="!disabled" ref="input" class="lp-input" v-model="query"
               :placeholder="placeholder" :data-testid="testid" autocomplete="off"
               @focus="open = true" @input="open = true"
               @keydown.enter.prevent="commit" @keydown.esc="open = false">
        <span v-else class="us-empty">—</span>
      </div>
      <ul v-if="open && !disabled && !selected" class="lp-list">
        <li v-for="o in filtered" :key="o.id" @mousedown.prevent="pick(o)">{{ o.name }}</li>
        <li v-if="!filtered.length" class="us-empty">{{ t('select.no_matches') }}</li>
      </ul>
    </div>`,
};

// реєстрація спільних компонентів у Vue-застосунку сторінки
function registerSharedComponents(app) {
  app.component("UserAvatar", UserAvatar);
  app.component("UserSelect", UserSelect);
  app.component("ProfileModal", ProfileModal);
  app.component("AttachmentGrid", AttachmentGrid);
  app.component("LabelPicker", LabelPicker);
  app.component("SearchSelect", SearchSelect);
  return app;
}
