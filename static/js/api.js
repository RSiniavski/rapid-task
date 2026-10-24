/* ============================================================
   Rapid Task — API клієнт
   Обгортка над fetch: токен у localStorage, JSON, помилки.
   ============================================================ */

const API = {
  base: "",  // той самий origin — фронт роздається FastAPI'єм

  token() {
    return localStorage.getItem("rt_token");
  },

  setToken(token) {
    if (token) localStorage.setItem("rt_token", token);
    else localStorage.removeItem("rt_token");
  },

  async request(method, path, { json = null, form = null, formData = null, auth = true, query = null } = {}) {
    const headers = {};
    if (json !== null) headers["Content-Type"] = "application/json";
    if (auth && this.token()) headers["Authorization"] = `Bearer ${this.token()}`;

    let url = this.base + path;
    if (query) {
      const qs = new URLSearchParams(
        Object.entries(query).filter(([, v]) => v !== null && v !== undefined)
      ).toString();
      if (qs) url += (url.includes("?") ? "&" : "?") + qs;
    }

    const res = await fetch(url, {
      method,
      headers,
      body: json !== null ? JSON.stringify(json)
        : (formData ? formData : (form ? new URLSearchParams(form) : undefined)),
    });

    if (!res.ok) {
      let detail = `${res.status} ${res.statusText}`;
      try {
        const body = await res.json();
        if (body && body.detail) {
          if (typeof body.detail === "string") detail = body.detail;
          else if (body.detail && Array.isArray(body.detail.errors)) detail = body.detail.errors.join("; ");
          else detail = JSON.stringify(body.detail);
        }
      } catch (_) { /* не JSON — лишаємо статус */ }
      const err = new Error(detail);
      err.status = res.status;
      throw err;
    }

    if (res.status === 204) return null;
    return res.json();
  },

  // --- AUTH ---
  register(full_name, email, password) {
    return this.request("POST", "/api/auth/register", { json: { full_name, email, password }, auth: false });
  },

  login(email, password) {
    return this.request("POST", "/api/auth/login", { form: { username: email, password }, auth: false });
  },

  me() {
    return this.request("GET", "/api/auth/me").then((user) => {
      ThemeEngine.syncFromUser(user);   // apply the personal theme from the server
      return user;
    });
  },

  users() {
    return this.request("GET", "/api/auth/users");
  },

  // --- ПРОФІЛЬ (особистий кабінет) ---
  updateProfile(payload) {
    return this.request("PATCH", "/api/users/me", { json: payload });
  },

  uploadAvatar(file) {
    const fd = new FormData();
    fd.append("file", file);
    return this.request("POST", "/api/users/me/avatar", { formData: fd });
  },

  deleteAvatar() {
    return this.request("DELETE", "/api/users/me/avatar");
  },

  themes() {
    return this.request("GET", "/api/themes");
  },

  setMyTheme(themeId) {
    return this.request("PUT", "/api/users/me/theme", { json: { theme_id: themeId } });
  },

  importTheme(theme) {
    return this.request("POST", "/api/themes/import", { json: theme });
  },

  exportTheme(themeId) {
    return this.request("GET", `/api/themes/${themeId}/export`);
  },

  deleteTheme(themeId) {
    return this.request("DELETE", `/api/themes/${themeId}`);
  },

  projectThemeSettings(projectId) {
    return this.request("GET", `/api/projects/${projectId}/theme-settings`);
  },

  setProjectThemeSettings(projectId, payload) {
    return this.request("PUT", `/api/projects/${projectId}/theme-settings`, { json: payload });
  },

  // --- PROJECTS ---
  myProjects() {
    return this.request("GET", "/api/projects");
  },

  createProject(payload) {
    return this.request("POST", "/api/projects", { json: payload });
  },

  project(id) {
    return this.request("GET", `/api/projects/${id}`);
  },

  updateProject(id, payload) {
    return this.request("PATCH", `/api/projects/${id}`, { json: payload });
  },

  deleteProject(id) {
    return this.request("DELETE", `/api/projects/${id}`);
  },

  dashboard() {
    return this.request("GET", "/api/projects/dashboard");
  },

  projectStats(id) {
    return this.request("GET", `/api/projects/${id}/stats`);
  },

  // --- MEMBERS ---
  members(projectId) {
    return this.request("GET", `/api/projects/${projectId}/members`);
  },

  addMember(projectId, payload) {
    return this.request("POST", `/api/projects/${projectId}/members`, { json: payload });
  },

  updateMemberRole(projectId, userId, role) {
    return this.request("PATCH", `/api/projects/${projectId}/members/${userId}`, { json: { role } });
  },

  removeMember(projectId, userId) {
    return this.request("DELETE", `/api/projects/${projectId}/members/${userId}`);
  },

  // --- COLUMNS ---
  columns(projectId) {
    return this.request("GET", `/api/projects/${projectId}/columns`);
  },

  createColumn(projectId, payload) {
    return this.request("POST", `/api/projects/${projectId}/columns`, { json: payload });
  },

  updateColumn(projectId, columnId, payload) {
    return this.request("PATCH", `/api/projects/${projectId}/columns/${columnId}`, { json: payload });
  },

  deleteColumn(projectId, columnId, moveTo = null) {
    return this.request("DELETE", `/api/projects/${projectId}/columns/${columnId}`,
      { query: { move_tickets_to: moveTo } });
  },

  // --- TICKETS ---
  projectTickets(projectId) {
    return this.request("GET", `/api/tickets/project/${projectId}`);
  },

  ticketByKey(key) {
    return this.request("GET", `/api/tickets/key/${encodeURIComponent(key)}`);
  },

  createTicket(projectId, payload) {
    return this.request("POST", `/api/tickets/project/${projectId}`, { json: payload });
  },

  updateTicket(ticketId, payload) {
    return this.request("PATCH", `/api/tickets/${ticketId}`, { json: payload });
  },

  moveTicket(ticketId, columnId) {
    return this.request("PATCH", `/api/tickets/${ticketId}/column`, { json: { column_id: columnId } });
  },

  deleteTicket(ticketId) {
    return this.request("DELETE", `/api/tickets/${ticketId}`);
  },

  // --- ВКЛАДЕННЯ ---
  // ticketId = null — файл для ще не створеного тікета
  uploadAttachment(projectId, ticketId, file) {
    const fd = new FormData();
    fd.append("file", file);
    return this.request("POST", "/api/attachments", {
      formData: fd,
      query: { project_id: projectId, ticket_id: ticketId },
    });
  },

  deleteAttachment(attachmentId) {
    return this.request("DELETE", `/api/attachments/${attachmentId}`);
  },

  // --- ROADMAP (віхи, залежності, розкладка) ---
  roadmap(projectId) {
    return this.request("GET", `/api/roadmap/project/${projectId}`);
  },

  createMilestone(projectId, payload) {
    return this.request("POST", `/api/roadmap/project/${projectId}/milestones`, { json: payload });
  },

  updateMilestone(milestoneId, payload) {
    return this.request("PATCH", `/api/roadmap/milestones/${milestoneId}`, { json: payload });
  },

  deleteMilestone(milestoneId) {
    return this.request("DELETE", `/api/roadmap/milestones/${milestoneId}`);
  },

  createDependency(projectId, payload) {
    return this.request("POST", `/api/roadmap/project/${projectId}/dependencies`, { json: payload });
  },

  updateDependency(dependencyId, type) {
    return this.request("PATCH", `/api/roadmap/dependencies/${dependencyId}`, { json: { type } });
  },

  deleteDependency(dependencyId) {
    return this.request("DELETE", `/api/roadmap/dependencies/${dependencyId}`);
  },

  saveRoadmapLayout(projectId, items) {
    return this.request("PUT", `/api/roadmap/project/${projectId}/layout`, { json: { items } });
  },

  // milestoneId = null — зняти тікет з віхи
  setTicketMilestone(ticketId, milestoneId) {
    return this.request("PATCH", `/api/tickets/${ticketId}`, { json: { milestone_id: milestoneId } });
  },
};
