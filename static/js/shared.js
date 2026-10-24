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
    boxStyle() {
      return { width: this.size + "px", height: this.size + "px", fontSize: Math.round(this.size * 0.58) + "px" };
    },
  },
  template: `
    <span class="avatar" :style="boxStyle" :class="{ 'avatar-stub': !hasImage }">
      <img v-if="hasImage" :src="user.avatar_url" :alt="user.full_name" @error="broken = true">
      <span v-else class="avatar-glyph">{{ stub }}</span>
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
  data() { return { open: false }; },
  computed: {
    selected() { return this.users.find(u => u.id === this.modelValue) || null; },
  },
  methods: {
    toggle() { if (!this.disabled) this.open = !this.open; },
    pick(id) { this.$emit("update:modelValue", id); this.open = false; },
    onDocClick(e) { if (!this.$el.contains(e.target)) this.open = false; },
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
        <li class="us-item" :class="{ active: modelValue === null }" @click="pick(null)" role="option">
          <span class="us-name us-empty">{{ placeholder }}</span>
        </li>
        <li v-for="u in users" :key="u.id" class="us-item" :class="{ active: u.id === modelValue }"
            @click="pick(u.id)" role="option">
          <user-avatar :user="u" :size="24" :stub="stub"></user-avatar>
          <span class="us-name">{{ u.full_name }}</span>
          <span class="us-sub" v-if="u.position">{{ u.position }}</span>
        </li>
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
    return { fullName: "", position: "", error: "", ok: "", busy: false, themeKey: ThemeEngine.current(), themes: ThemeEngine.list(), themeLocked: false };
  },
  watch: {
    open(val) {
      if (val && this.user) {
        this.fullName = this.user.full_name || "";
        this.position = this.user.position || "";
        this.error = "";
        this.ok = "";
        this.themeKey = ThemeEngine.current();
        this.themeLocked = ThemeEngine.isLocked();
      }
    },
  },
  methods: {
    t: i18nGet,
    async onTheme() {
      ThemeEngine.select(this.themeKey);          // instant change in the browser
      try {
        const all = await API.themes();            // server themes (they have numeric ids)
        const found = all.find((x) => x.key === this.themeKey);
        const updated = await API.setMyTheme(found ? found.id : null);
        this.$emit("updated", updated);
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
            <select class="input" data-testid="theme-select" v-model="themeKey" @change="onTheme" :disabled="themeLocked">
              <option v-for="th in themes" :key="th.key" :value="th.key">{{ th.name }}</option>
            </select>
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

// реєстрація спільних компонентів у Vue-застосунку сторінки
function registerSharedComponents(app) {
  app.component("UserAvatar", UserAvatar);
  app.component("UserSelect", UserSelect);
  app.component("ProfileModal", ProfileModal);
  app.component("AttachmentGrid", AttachmentGrid);
  return app;
}
