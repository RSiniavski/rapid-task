/* ============================================================
   Rapid Task Platform — API wrapper
   The token has its own storage key (rt_platform_token): a platform token never mixes with the app's rt_token.
   ============================================================ */
const PlatformAPI = (() => {
  const TOKEN_KEY = "rt_platform_token";
  let sessionEnded = null;

  const getToken = () => { try { return localStorage.getItem(TOKEN_KEY) || ""; } catch (_) { return ""; } };
  function setToken(token) {
    try {
      if (token) localStorage.setItem(TOKEN_KEY, token); else localStorage.removeItem(TOKEN_KEY);
    } catch (_) { /* private mode: the session lasts until the page is closed */ }
  }

  // FastAPI sends detail as text or as a list of validation problems
  function messageOf(data, status) {
    const d = data && data.detail;
    if (typeof d === "string") return d;
    if (Array.isArray(d) && d.length) {
      return d.map((x) => String((x && x.msg) || "Invalid value").replace(/^Value error,\s*/i, "")).join("; ");
    }
    return `Request failed (${status})`;
  }

  async function request(method, path, body, { auth = true } = {}) {
    const headers = {};
    if (body !== undefined) headers["Content-Type"] = "application/json";
    const token = auth ? getToken() : "";
    if (token) headers.Authorization = "Bearer " + token;
    let res;
    try {
      res = await fetch("/api/platform" + path, {
        method, headers, body: body !== undefined ? JSON.stringify(body) : undefined,
      });
    } catch (_) {
      throw Object.assign(new Error("Can not reach the server. Check your connection."), { status: 0 });
    }
    if (res.status === 204) return null;
    let data = null;
    try { data = await res.json(); } catch (_) { /* no JSON body */ }
    if (!res.ok) {
      const err = Object.assign(new Error(messageOf(data, res.status)), { status: res.status, data });
      const ended = auth && (res.status === 401 || (res.status === 403 && data && data.detail === "This account is disabled"));
      if (ended && sessionEnded) sessionEnded(res.status === 401 ? "Your session has ended. Please sign in again." : err.message);
      throw err;
    }
    return data;
  }

  return {
    getToken, setToken,
    onSessionEnd(fn) { sessionEnded = fn; },
    login: (username, password) => request("POST", "/auth/login", { username, password }, { auth: false }),
    me: () => request("GET", "/auth/me"),
    setTheme: (theme_key) => request("PUT", "/auth/me/theme", { theme_key }),
    // administrators (root only)
    admins: () => request("GET", "/admins"),
    createAdmin: (data) => request("POST", "/admins", data),
    updateAdmin: (id, data) => request("PATCH", `/admins/${id}`, data),
    resetAdminPassword: (id, password) => request("POST", `/admins/${id}/password`, { password }),
    deleteAdmin: (id) => request("DELETE", `/admins/${id}`),
    // users of the app
    users(params) {
      const q = new URLSearchParams();
      for (const [k, v] of Object.entries(params || {})) if (v !== "" && v !== null && v !== undefined) q.set(k, v);
      return request("GET", "/users?" + q.toString());
    },
    blockUser: (id) => request("POST", `/users/${id}/block`),
    unblockUser: (id) => request("POST", `/users/${id}/unblock`),
    deleteUser: (id) => request("DELETE", `/users/${id}`),
    // overview
    overview: (days) => request("GET", "/overview?days=" + encodeURIComponent(days)),
    // system health
    health: () => request("GET", "/health"),
    // audit log
    auditActions: () => request("GET", "/audit/actions"),
    audit(params) {
      const q = new URLSearchParams();
      for (const [k, v] of Object.entries(params || {})) if (v !== "" && v !== null && v !== undefined) q.set(k, v);
      return request("GET", "/audit?" + q.toString());
    },
  };
})();
