/* ============================================================
   Rapid Task Platform — the Pages section (needs the "Manage pages" permission)
   The site pages (Donate, Terms, Privacy, Cookies ...): list, create, edit, publish / unpublish, delete.
     Draft = not public | Published = live at /p/<address>. Save changes a published page at once.
   The text is Markdown (the editor saves Markdown). One text per language (uk and en).
   ============================================================ */
(function () {
  // the editor toolbar of the admin tool is in English (the admin tool has no language switch)
  window.i18nGet = (key) => (I18N.en && I18N.en[key]) || (I18N.uk && I18N.uk[key]) || key;       // I18N is a global const (not on window)

  document.addEventListener("DOMContentLoaded", () => { document.documentElement.lang = "en"; });   // i18n.js sets the site language

  const BLANK = () => ({
    id: null, slug: "", title_uk: "", title_en: "", content_uk: "", content_en: "",
    in_footer: false, in_register: false, sort_order: 0, status: "draft", is_system: false,
  });
  const SAVED_FIELDS = ["slug", "title_uk", "title_en", "content_uk", "content_en", "in_footer", "in_register", "sort_order"];
  const snapshot = (f) => JSON.stringify(SAVED_FIELDS.map((k) => f[k]));

  window.PlatformPages = {
    name: "PlatformPages",
    emits: ["notify"],

    data() {
      return {
        items: [], loading: true, loadError: "", busyId: null,
        view: "list",                       // "list" | "edit"
        form: BLANK(), saved: "", lang: "uk", preview: false, loadingForm: false,
        formBusy: false, formError: "",
        modal: null,                        // { page } (delete question)
        modalBusy: false, modalError: "",
      };
    },

    computed: {
      isNew() { return this.form.id === null; },
      dirty() { return snapshot(this.form) !== this.saved; },
      slugOk() { return /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(this.form.slug.trim().toLowerCase()) && this.form.slug.trim().length >= 2; },
      hasTitle() { return !!(this.form.title_uk.trim() || this.form.title_en.trim()); },
      canSave() { return !this.formBusy && this.slugOk && this.hasTitle && (this.isNew || this.dirty); },
      published() { return this.form.status === "published"; },
      previewHtml() {
        const text = this.form["content_" + this.lang] || "";
        return window.RTMarkdown && RTMarkdown.ready() ? RTMarkdown.render(text, { keys: false }) : "";
      },
    },

    methods: {
      fmt: PlatformUI.fmt,
      notify(message, kind) { this.$emit("notify", message, kind || "ok"); },
      title(p) { return p.title_en || p.title_uk || p.slug; },

      async load(silent) {
        if (!silent) this.loading = true;
        this.loadError = "";
        try {
          this.items = await PlatformAPI.pages();
        } catch (err) {
          if (err.status === 401) return;
          this.loadError = err.message;
        } finally {
          this.loading = false;
        }
      },

      /* ---- list ---- */
      async quick(p, action) {
        if (this.busyId !== null) return;
        this.busyId = p.id;
        try {
          await (action === "publish" ? PlatformAPI.publishPage(p.id) : PlatformAPI.unpublishPage(p.id));
          this.notify(action === "publish" ? `${this.title(p)} is published.` : `${this.title(p)} is a draft now.`);
        } catch (err) {
          if (err.status === 401) return;
          this.notify(err.message, "error");
        } finally {
          this.busyId = null;
        }
        this.load(true);
      },

      /* ---- editor ---- */
      openNew() {
        this.form = BLANK();
        this.saved = snapshot(this.form);
        this.lang = "uk"; this.preview = false; this.formError = "";
        this.view = "edit";
      },
      async openEdit(p) {
        if (this.loadingForm) return;
        this.loadingForm = true;
        try {
          const page = await PlatformAPI.page(p.id);
          this.form = Object.assign(BLANK(), page);
          this.saved = snapshot(this.form);
          this.lang = "uk"; this.preview = false; this.formError = "";
          this.view = "edit";
        } catch (err) {
          if (err.status === 401) return;
          this.notify(err.message, "error");
          if (err.status === 404) this.load(true);
        } finally {
          this.loadingForm = false;
        }
      },
      back() {
        if (this.dirty && !window.confirm("Leave without saving? Your changes will be lost.")) return;
        this.view = "list";
        this.load(true);
      },
      body() {
        const f = this.form;
        return {
          slug: f.slug.trim().toLowerCase(), title_uk: f.title_uk, title_en: f.title_en,
          content_uk: f.content_uk, content_en: f.content_en,
          in_footer: f.in_footer, in_register: f.in_register, sort_order: Number(f.sort_order) || 0,
        };
      },
      keep(page) {                          // take what the server saved (it trims and lower-cases)
        this.form = Object.assign(BLANK(), page);
        this.saved = snapshot(this.form);
      },
      async save() {
        if (!this.canSave) return false;
        this.formBusy = true; this.formError = "";
        try {
          const body = this.body();
          if (this.form.is_system) delete body.slug;
          const page = this.isNew ? await PlatformAPI.createPage(body) : await PlatformAPI.updatePage(this.form.id, body);
          this.keep(page);
          this.notify(this.published ? "Saved. The page is live." : "Saved.");
          return true;
        } catch (err) {
          if (err.status !== 401) this.formError = err.message;
          return false;
        } finally {
          this.formBusy = false;
        }
      },
      async toggleStatus() {
        if (this.formBusy) return;
        if ((this.dirty || this.isNew) && !(await this.save())) return;
        this.formBusy = true; this.formError = "";
        try {
          const page = await (this.published ? PlatformAPI.unpublishPage(this.form.id) : PlatformAPI.publishPage(this.form.id));
          this.keep(page);
          this.notify(this.published ? "Published. The page is live." : "The page is a draft now.");
        } catch (err) {
          if (err.status !== 401) this.formError = err.message;
        } finally {
          this.formBusy = false;
        }
      },

      /* ---- delete ---- */
      ask(p) { this.modalError = ""; this.modalBusy = false; this.modal = { page: p }; },
      closeModal() { if (!this.modalBusy) this.modal = null; },
      async confirmDelete() {
        const m = this.modal;
        if (!m || this.modalBusy) return;
        this.modalBusy = true; this.modalError = "";
        try {
          await PlatformAPI.deletePage(m.page.id);
          this.notify(`${this.title(m.page)} is deleted.`);
          this.modalBusy = false;
          this.modal = null;
          this.view = "list";
          this.load(true);
        } catch (err) {
          this.modalBusy = false;
          if (err.status === 401) return;
          this.modalError = err.message;
          if (err.status === 404) this.load(true);
        }
      },
      onKey(e) { if (e.key === "Escape" && this.modal) this.closeModal(); },
    },

    mounted() {
      document.addEventListener("keydown", this.onKey);
      this.load();
    },
    beforeUnmount() { document.removeEventListener("keydown", this.onKey); },

    template: `
    <section data-testid="pages-page">
      <!-- ============ list ============ -->
      <template v-if="view === 'list'">
        <div class="pl-toolbar">
          <p class="pl-muted">Pages of the site. A published page is public at <code>/p/address</code>.</p>
          <button type="button" class="btn btn-primary" data-testid="page-new" @click="openNew">New page</button>
        </div>

        <article class="pl-card pl-table-card">
          <div class="pl-pad pl-muted" v-if="loading" data-testid="pages-loading">Loading…</div>
          <div class="pl-pad" v-else-if="loadError" data-testid="pages-error" role="alert">
            <p class="pl-muted">{{ loadError }}</p>
            <button type="button" class="btn btn-ghost btn-sm" @click="load()">Try again</button>
          </div>
          <div class="pl-pad pl-muted" v-else-if="!items.length" data-testid="pages-empty">No pages yet.</div>
          <div class="pl-table-wrap" v-else>
            <table class="pl-table" data-testid="pages-table">
              <thead>
                <tr>
                  <th>Page</th><th>Status</th><th>Text</th><th>Shown in</th><th>Updated</th>
                  <th class="pl-th-actions">Actions</th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="p in items" :key="p.id" data-testid="page-row" :data-slug="p.slug" :data-status="p.status">
                  <td>
                    <span class="pl-person-text">
                      <strong data-testid="page-title">{{ title(p) }}</strong>
                      <small data-testid="page-slug">/p/{{ p.slug }}</small>
                    </span>
                    <span class="pl-pill" v-if="p.is_system" data-testid="page-system" title="A system page cannot be deleted">System</span>
                  </td>
                  <td><span class="pl-pill" :class="p.status === 'published' ? 'ok' : ''" data-testid="page-status">{{ p.status === "published" ? "Published" : "Draft" }}</span></td>
                  <td>
                    <span class="pl-flags">
                      <span class="pl-pill" :class="p.has_uk ? 'ok' : 'warn'" data-testid="page-has-uk">UK</span>
                      <span class="pl-pill" :class="p.has_en ? 'ok' : 'warn'" data-testid="page-has-en">EN</span>
                    </span>
                  </td>
                  <td data-testid="page-places">
                    <span class="pl-muted" v-if="!p.in_footer && !p.in_register">—</span>
                    <span class="pl-flags" v-else>
                      <span class="pl-pill" v-if="p.in_footer">Footer</span>
                      <span class="pl-pill" v-if="p.in_register">Register form</span>
                    </span>
                  </td>
                  <td class="pl-nowrap">
                    {{ fmt(p.updated_at) }}<small class="pl-reason" v-if="p.updated_by">{{ p.updated_by }}</small>
                  </td>
                  <td>
                    <div class="pl-actions">
                      <button type="button" class="btn btn-ghost pl-act" data-testid="page-edit" :disabled="loadingForm"
                              :aria-label="'Edit ' + title(p)" @click="openEdit(p)">Edit</button>
                      <button v-if="p.status !== 'published'" type="button" class="btn btn-ghost pl-act" data-testid="page-publish"
                              :disabled="busyId !== null" :aria-label="'Publish ' + title(p)" @click="quick(p, 'publish')">Publish</button>
                      <button v-else type="button" class="btn btn-ghost pl-act" data-testid="page-unpublish"
                              :disabled="busyId !== null" :aria-label="'Unpublish ' + title(p)" @click="quick(p, 'unpublish')">Unpublish</button>
                      <button v-if="!p.is_system" type="button" class="btn btn-ghost pl-act" data-testid="page-delete"
                              :disabled="busyId !== null" :aria-label="'Delete ' + title(p)" @click="ask(p)">Delete</button>
                    </div>
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </article>
      </template>

      <!-- ============ editor ============ -->
      <template v-else>
        <div class="pl-toolbar">
          <button type="button" class="btn btn-ghost btn-sm" data-testid="page-back" @click="back">← All pages</button>
          <span class="pl-pill" :class="published ? 'ok' : ''" data-testid="page-form-status">{{ published ? "Published" : "Draft" }}</span>
          <span class="pl-muted" v-if="dirty" data-testid="page-dirty">Unsaved changes</span>
        </div>

        <form class="pl-card pl-pages-form" data-testid="page-form" novalidate @submit.prevent="save">
          <div class="pl-pages-row">
            <div class="field">
              <label for="pl-pg-slug">Address</label>
              <div class="pl-pages-slug">
                <span class="pl-muted">/p/</span>
                <input id="pl-pg-slug" class="input" v-model="form.slug" maxlength="60" autocomplete="off" spellcheck="false"
                       :disabled="form.is_system" placeholder="terms" data-testid="page-slug-input">
              </div>
              <small class="pl-muted" v-if="form.is_system">The address of a system page is fixed.</small>
              <small class="pl-muted" v-else>Small letters, digits and dashes (2–60 characters).</small>
            </div>
            <div class="field">
              <label for="pl-pg-order">Order</label>
              <input id="pl-pg-order" class="input" type="number" min="0" max="9999" v-model="form.sort_order" data-testid="page-order-input">
            </div>
          </div>

          <div class="pl-pages-row">
            <div class="field">
              <label for="pl-pg-title-uk">Title (Ukrainian)</label>
              <input id="pl-pg-title-uk" class="input" v-model="form.title_uk" maxlength="120" autocomplete="off" data-testid="page-title-uk">
            </div>
            <div class="field">
              <label for="pl-pg-title-en">Title (English)</label>
              <input id="pl-pg-title-en" class="input" v-model="form.title_en" maxlength="120" autocomplete="off" data-testid="page-title-en">
            </div>
          </div>

          <div class="pl-pages-row pl-pages-checks">
            <label class="pl-auto"><input type="checkbox" v-model="form.in_footer" data-testid="page-in-footer"> Show a link in the site footer</label>
            <label class="pl-auto"><input type="checkbox" v-model="form.in_register" data-testid="page-in-register"> Show a link in the register form</label>
          </div>

          <div class="pl-tabs" role="tablist" aria-label="Language" data-testid="page-lang-tabs">
            <button type="button" role="tab" class="pl-tab" :class="{ on: lang === 'uk' }" :aria-selected="lang === 'uk' ? 'true' : 'false'"
                    data-testid="page-lang-uk" @click="lang = 'uk'">Ukrainian</button>
            <button type="button" role="tab" class="pl-tab" :class="{ on: lang === 'en' }" :aria-selected="lang === 'en' ? 'true' : 'false'"
                    data-testid="page-lang-en" @click="lang = 'en'">English</button>
            <span class="pl-tabs-gap" aria-hidden="true"></span>
            <button type="button" class="pl-tab" :class="{ on: preview }" :aria-pressed="preview ? 'true' : 'false'"
                    data-testid="page-preview-toggle" @click="preview = !preview">Preview</button>
          </div>
          <p class="pl-muted pl-note">An empty text shows the text of the other language.</p>

          <div v-show="!preview">
            <div v-show="lang === 'uk'"><rich-editor v-model="form.content_uk" testid="page-editor-uk"></rich-editor></div>
            <div v-show="lang === 'en'"><rich-editor v-model="form.content_en" testid="page-editor-en"></rich-editor></div>
          </div>
          <div v-if="preview" class="md site-page-body pl-pages-preview" data-testid="page-preview" v-html="previewHtml"></div>

          <div class="form-error" role="alert" data-testid="page-form-error">{{ formError }}</div>
          <div class="pl-modal-actions pl-pages-actions">
            <button v-if="!isNew && !form.is_system" type="button" class="btn btn-ghost pl-danger-text" data-testid="page-form-delete"
                    :disabled="formBusy" @click="ask(form)">Delete</button>
            <span class="pl-spacer"></span>
            <button type="button" class="btn btn-ghost" data-testid="page-form-toggle" :disabled="formBusy || (isNew && !canSave)" @click="toggleStatus">
              {{ published ? "Unpublish" : "Publish" }}
            </button>
            <button type="submit" class="btn btn-primary" data-testid="page-save" :disabled="!canSave">{{ formBusy ? "Saving…" : "Save" }}</button>
          </div>
        </form>
      </template>

      <!-- ============ delete question ============ -->
      <div class="modal-backdrop open" v-if="modal" data-testid="page-modal-backdrop" @mousedown.self="closeModal">
        <form class="modal pl-modal" role="dialog" aria-modal="true" aria-label="Delete page" data-testid="page-modal" @submit.prevent="confirmDelete" novalidate>
          <button type="button" class="modal-close" aria-label="Close" data-testid="page-modal-close" @click="closeModal">×</button>
          <h2 class="pl-modal-title">Delete page</h2>
          <p class="pl-modal-text">Delete <strong data-testid="page-target">{{ title(modal.page) }}</strong> (/p/{{ modal.page.slug }})?</p>
          <ul class="pl-modal-list">
            <li>The page and its texts are removed for good. The link stops working.</li>
            <li><strong>This can not be undone.</strong></li>
          </ul>
          <div class="form-error" role="alert" data-testid="page-modal-error">{{ modalError }}</div>
          <div class="pl-modal-actions">
            <button type="button" class="btn btn-ghost" data-testid="page-modal-cancel" :disabled="modalBusy" @click="closeModal">Cancel</button>
            <button type="submit" class="btn btn-danger" data-testid="page-modal-confirm" :disabled="modalBusy">{{ modalBusy ? "Working…" : "Delete" }}</button>
          </div>
        </form>
      </div>
    </section>`,
  };
})();
