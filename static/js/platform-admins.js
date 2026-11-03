/* ============================================================
   Rapid Task Platform — the Administrators section (root only)
   List, create, edit name and permissions, block / unblock, reset password, delete.
   The root account has no actions: it is managed outside this page.
   ============================================================ */
const PlatformAdmins = {
  name: "PlatformAdmins",
  props: { me: { type: Object, required: true } },
  emits: ["notify"],

  data() {
    return {
      items: [],
      loading: true,
      loadError: "",
      busyId: null,                 // the row whose block / unblock request is running
      modal: null,                  // { type: "create" | "edit" | "password" | "delete", admin }
      form: this.blankForm(),
      formBusy: false,
      formError: "",
      showPassword: false,
      perms: PlatformUI.PERMS,
    };
  },

  computed: {
    activeCount() { return this.items.filter((a) => a.is_active).length; },
    others() { return this.items.filter((a) => !a.is_root); },
    modalTitle() {
      const m = this.modal;
      if (!m) return "";
      if (m.type === "create") return "New administrator";
      if (m.type === "edit") return "Edit administrator";
      if (m.type === "password") return "Reset password";
      return "Delete administrator";
    },
    submitLabel() {
      const m = this.modal;
      if (!m) return "";
      const busy = this.formBusy;
      if (m.type === "create") return busy ? "Creating…" : "Create";
      if (m.type === "edit") return busy ? "Saving…" : "Save";
      if (m.type === "password") return busy ? "Saving…" : "Set password";
      return busy ? "Deleting…" : "Delete";
    },
    changes() {                     // only the fields the root really changed are sent
      const m = this.modal;
      if (!m || m.type !== "edit") return {};
      const out = {};
      const name = this.form.display_name.trim();
      if (name !== m.admin.display_name) out.display_name = name;
      for (const p of this.perms) if (this.form[p.key] !== m.admin[p.key]) out[p.key] = this.form[p.key];
      return out;
    },
    submitDisabled() {
      const m = this.modal;
      if (!m || this.formBusy) return true;
      const f = this.form;
      if (m.type === "create") return !f.username.trim() || !f.display_name.trim() || !f.password;
      if (m.type === "edit") return Object.keys(this.changes).length === 0;
      if (m.type === "password") return !f.password;
      return false;
    },
  },

  methods: {
    fmt: PlatformUI.fmt,
    initials: PlatformUI.initials,

    blankForm() {
      const f = { username: "", display_name: "", password: "" };
      for (const p of PlatformUI.PERMS) f[p.key] = false;
      return f;
    },
    notify(message, kind) { this.$emit("notify", message, kind || "ok"); },
    permsOf(a) { return this.perms.filter((p) => a[p.key]); },

    async load(silent) {
      if (!silent) this.loading = true;
      this.loadError = "";
      try {
        this.items = await PlatformAPI.admins();
      } catch (err) {
        if (err.status !== 401) this.loadError = err.message;
      } finally {
        this.loading = false;
      }
    },
    replace(updated) {
      const i = this.items.findIndex((a) => a.id === updated.id);
      if (i >= 0) this.items.splice(i, 1, updated); else this.items.push(updated);
    },

    // ---------- dialogs
    open(type, admin) {
      this.form = this.blankForm();
      if (type === "edit") {
        this.form.display_name = admin.display_name;
        for (const p of this.perms) this.form[p.key] = !!admin[p.key];
      }
      this.formError = "";
      this.formBusy = false;
      this.showPassword = false;
      this.modal = { type, admin: admin || null };
      this.$nextTick(() => { const el = this.$refs.first; if (el && el.focus) el.focus(); });
    },
    closeModal() {
      if (this.formBusy) return;
      this.modal = null;
    },
    onKey(e) { if (e.key === "Escape" && this.modal) this.closeModal(); },

    makePassword() {
      this.form.password = PlatformUI.generatePassword();
      this.showPassword = true;                 // the root must see it to hand it over
    },
    async copyPassword() {
      try {
        await navigator.clipboard.writeText(this.form.password);
        this.notify("Password copied.");
      } catch (_) {
        this.notify("Could not copy. Select the password and copy it by hand.", "error");
      }
    },

    passwordProblem(password) {
      if (password.length < 8) return "The password must have at least 8 characters.";
      if (new TextEncoder().encode(password).length > 72) return "The password is too long (72 bytes at most).";
      return "";
    },
    createProblem() {
      const f = this.form;
      if (!/^[a-z0-9][a-z0-9_.-]{2,39}$/.test(f.username.trim().toLowerCase())) {
        return "Username: 3-40 characters, a-z, 0-9, _ . - (start with a letter or digit).";
      }
      if (f.display_name.trim().length < 2) return "The name must have at least 2 characters.";
      return this.passwordProblem(f.password);
    },

    async submit() {
      const m = this.modal;
      if (!m || this.submitDisabled) return;
      this.formError = "";
      let problem = "";
      if (m.type === "create") problem = this.createProblem();
      else if (m.type === "password") problem = this.passwordProblem(this.form.password);
      else if (m.type === "edit" && "display_name" in this.changes && this.changes.display_name.length < 2) {
        problem = "The name must have at least 2 characters.";
      }
      if (problem) { this.formError = problem; return; }

      this.formBusy = true;
      try {
        const f = this.form;
        if (m.type === "create") {
          const body = { username: f.username.trim().toLowerCase(), display_name: f.display_name.trim(), password: f.password };
          for (const p of this.perms) body[p.key] = !!f[p.key];
          const created = await PlatformAPI.createAdmin(body);
          this.replace(created);
          this.notify(`Administrator ${created.username} created.`);
        } else if (m.type === "edit") {
          const updated = await PlatformAPI.updateAdmin(m.admin.id, this.changes);
          this.replace(updated);
          this.notify(`Saved the changes of ${updated.username}.`);
        } else if (m.type === "password") {
          await PlatformAPI.resetAdminPassword(m.admin.id, f.password);
          this.notify(`New password set for ${m.admin.username}.`);
        } else {
          await PlatformAPI.deleteAdmin(m.admin.id);
          this.items = this.items.filter((a) => a.id !== m.admin.id);
          this.notify(`Administrator ${m.admin.username} deleted.`);
        }
        this.formBusy = false;
        this.modal = null;
      } catch (err) {
        this.formBusy = false;
        if (err.status === 401) return;                    // the session ended: the page goes to the login
        this.formError = err.message;
        if (err.status === 404) this.load(true);           // somebody removed this admin meanwhile
      }
    },

    async toggle(a) {
      if (this.busyId !== null) return;
      this.busyId = a.id;
      try {
        const updated = await PlatformAPI.updateAdmin(a.id, { is_active: !a.is_active });
        this.replace(updated);
        this.notify(updated.is_active ? `${updated.username} is active again.` : `${updated.username} is blocked.`);
      } catch (err) {
        if (err.status !== 401) {
          this.notify(err.message, "error");
          if (err.status === 404) this.load(true);
        }
      } finally {
        this.busyId = null;
      }
    },
  },

  mounted() {
    document.addEventListener("keydown", this.onKey);
    this.load();
  },
  beforeUnmount() { document.removeEventListener("keydown", this.onKey); },

  template: `
  <section data-testid="admins-page">
    <div class="pl-toolbar">
      <p class="pl-muted" data-testid="admins-count" v-if="!loading && !loadError">{{ items.length }} accounts · {{ activeCount }} active</p>
      <span v-else></span>
      <button type="button" class="btn btn-primary btn-sm" data-testid="admin-new" @click="open('create')">+ New administrator</button>
    </div>

    <article class="pl-card pl-table-card">
      <p class="pl-muted pl-pad" v-if="loading" data-testid="admins-loading">Loading…</p>
      <div class="pl-pad" v-else-if="loadError">
        <p class="form-error" role="alert" data-testid="admins-error">{{ loadError }}</p>
        <button type="button" class="btn btn-ghost btn-sm" data-testid="admins-retry" @click="load()">Try again</button>
      </div>
      <template v-else>
        <div class="pl-table-wrap">
          <table class="pl-table" data-testid="admins-table">
            <thead>
              <tr><th>Administrator</th><th>Status</th><th>Permissions</th><th>Last login</th><th class="pl-th-actions">Actions</th></tr>
            </thead>
            <tbody>
              <tr v-for="a in items" :key="a.id" data-testid="admin-row" :data-username="a.username"
                  :class="{ 'is-blocked': !a.is_active }">
                <td>
                  <div class="pl-person">
                    <span class="pl-avatar" aria-hidden="true">{{ initials(a.display_name) }}</span>
                    <span class="pl-person-text">
                      <strong data-testid="admin-name">{{ a.display_name }}</strong>
                      <small data-testid="admin-username-text">@{{ a.username }}</small>
                    </span>
                    <span v-if="a.is_root" class="pl-role is-root" data-testid="admin-root-tag">ROOT</span>
                  </div>
                </td>
                <td><span class="pl-pill" :class="a.is_active ? 'ok' : 'bad'" data-testid="admin-status">{{ a.is_active ? "Active" : "Blocked" }}</span></td>
                <td>
                  <div class="pl-chips" data-testid="admin-perms">
                    <span v-if="a.is_root" class="pl-chip all">All</span>
                    <template v-else>
                      <span v-for="p in permsOf(a)" :key="p.key" class="pl-chip" :data-perm="p.key">{{ p.short }}</span>
                      <span v-if="!permsOf(a).length" class="pl-muted">No permissions</span>
                    </template>
                  </div>
                </td>
                <td class="pl-nowrap">{{ fmt(a.last_login_at) }}</td>
                <td>
                  <div class="pl-actions" v-if="!a.is_root">
                    <button type="button" class="btn btn-ghost pl-act" data-testid="admin-edit" :aria-label="'Edit ' + a.username" @click="open('edit', a)">Edit</button>
                    <button type="button" class="btn btn-ghost pl-act" data-testid="admin-password" :aria-label="'Reset password of ' + a.username" @click="open('password', a)">Password</button>
                    <button type="button" class="btn btn-ghost pl-act" data-testid="admin-toggle" :disabled="busyId !== null"
                            :aria-label="(a.is_active ? 'Block ' : 'Unblock ') + a.username" @click="toggle(a)">{{ a.is_active ? "Block" : "Unblock" }}</button>
                    <button type="button" class="btn btn-danger pl-act" data-testid="admin-delete" :aria-label="'Delete ' + a.username" @click="open('delete', a)">Delete</button>
                  </div>
                  <span v-else class="pl-muted" data-testid="admin-no-actions">—</span>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
        <p class="pl-muted pl-pad" v-if="!others.length" data-testid="admins-empty">No other administrators yet. Use “New administrator” to add the first one.</p>
      </template>
    </article>

    <div class="modal-backdrop open" v-if="modal" data-testid="admin-modal-backdrop" @mousedown.self="closeModal">
      <form class="modal pl-modal" role="dialog" aria-modal="true" :aria-label="modalTitle" data-testid="admin-modal"
            :data-type="modal.type" @submit.prevent="submit" novalidate>
        <button type="button" class="modal-close" aria-label="Close" data-testid="admin-modal-close" @click="closeModal">×</button>
        <h2 class="pl-modal-title" data-testid="admin-modal-title">{{ modalTitle }}</h2>

        <template v-if="modal.type === 'delete'">
          <p class="pl-modal-text">Delete <strong data-testid="admin-target">{{ modal.admin.display_name }}</strong> (@{{ modal.admin.username }})?
            The account stops working at once. The audit log keeps the name.</p>
        </template>

        <template v-else>
          <div class="field" v-if="modal.type === 'create'">
            <label for="pl-new-username">Username</label>
            <input id="pl-new-username" class="input" v-model="form.username" ref="first" autocomplete="off" autocapitalize="none"
                   spellcheck="false" maxlength="60" data-testid="admin-username" :disabled="formBusy">
          </div>
          <p class="pl-modal-text" v-else><strong>@{{ modal.admin.username }}</strong></p>

          <div class="field" v-if="modal.type !== 'password'">
            <label for="pl-new-name">Display name</label>
            <input id="pl-new-name" class="input" v-model="form.display_name" :ref="modal.type === 'edit' ? 'first' : null"
                   autocomplete="off" maxlength="100" data-testid="admin-display-name" :disabled="formBusy">
          </div>

          <div class="field" v-if="modal.type === 'create' || modal.type === 'password'">
            <label for="pl-new-password">{{ modal.type === 'create' ? 'Password' : 'New password' }}</label>
            <div class="pl-pass-row">
              <input id="pl-new-password" class="input" :type="showPassword ? 'text' : 'password'" v-model="form.password"
                     :ref="modal.type === 'password' ? 'first' : null" autocomplete="new-password" maxlength="72"
                     data-testid="admin-password-input" :disabled="formBusy">
              <button type="button" class="btn btn-ghost pl-act" data-testid="admin-password-show" :aria-pressed="showPassword ? 'true' : 'false'"
                      @click="showPassword = !showPassword">{{ showPassword ? "Hide" : "Show" }}</button>
              <button type="button" class="btn btn-ghost pl-act" data-testid="admin-generate" :disabled="formBusy" @click="makePassword">Generate</button>
              <button type="button" class="btn btn-ghost pl-act" data-testid="admin-copy" :disabled="!form.password" @click="copyPassword">Copy</button>
            </div>
            <small class="pl-hint">At least 8 characters. Tell the new password to the person yourself.</small>
          </div>

          <fieldset class="pl-fieldset" v-if="modal.type === 'create' || modal.type === 'edit'" :disabled="formBusy">
            <legend>Permissions</legend>
            <label class="pl-pick" v-for="p in perms" :key="p.key">
              <input type="checkbox" v-model="form[p.key]" :data-testid="'admin-perm-' + p.key">
              <span><strong>{{ p.label }}</strong><small>{{ p.hint }}</small></span>
            </label>
          </fieldset>
        </template>

        <div class="form-error" role="alert" data-testid="admin-modal-error">{{ formError }}</div>
        <div class="pl-modal-actions">
          <button type="button" class="btn btn-ghost" data-testid="admin-cancel" :ref="modal.type === 'delete' ? 'first' : null"
                  :disabled="formBusy" @click="closeModal">Cancel</button>
          <button type="submit" class="btn" :class="modal.type === 'delete' ? 'btn-danger' : 'btn-primary'" data-testid="admin-save"
                  :disabled="submitDisabled">{{ submitLabel }}</button>
        </div>
      </form>
    </div>
  </section>`,
};
