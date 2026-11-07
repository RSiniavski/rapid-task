/* ============================================================
   Rapid Task Platform — small shared helpers (used by platform.js and the section components)
   ============================================================ */
const PlatformUI = (() => {
  // the permissions of a platform admin (the keys are the server field names)
  const PERMS = [
    { key: "can_view_system_health", label: "System health", short: "Health", hint: "Watch the system, disk usage and logs" },
    { key: "can_view_analytics", label: "Analytics", short: "Analytics", hint: "Global statistics, charts and project highlights" },
    { key: "can_manage_users", label: "Manage users", short: "Users", hint: "Read users, change status, block or soft-delete" },
    { key: "can_manage_projects", label: "Manage projects", short: "Projects", hint: "Moderate projects, remove abandoned or spam ones" },
    { key: "can_view_audit_logs", label: "Audit log", short: "Audit", hint: "See what platform admins did" },
    { key: "can_manage_pages", label: "Manage pages", short: "Pages", hint: "Edit, publish and create site pages (Donate, Terms, Privacy ...)" },
  ];

  // the server sends UTC without a zone mark; 24-hour clock
  function fmt(value) {
    if (!value) return "—";
    const d = new Date(/(Z|[+-]\d\d:?\d\d)$/i.test(value) ? value : value + "Z");
    if (isNaN(d)) return "—";
    return d.toLocaleString("en-GB", {
      year: "numeric", month: "short", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false,
    });
  }

  function fmtDate(value) {
    if (!value) return "—";
    const d = new Date(/(Z|[+-]\d\d:?\d\d)$/i.test(value) ? value : value + "Z");
    if (isNaN(d)) return "—";
    return d.toLocaleDateString("en-GB", { year: "numeric", month: "short", day: "2-digit" });
  }

  function initials(name) {
    const words = String(name || "?").trim().split(/\s+/).slice(0, 2);
    return words.map((w) => w.charAt(0).toUpperCase()).join("") || "?";
  }

  // a random password (no look-alike letters); the browser's crypto is used
  function generatePassword(length = 16) {
    const chars = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789!#$%*-_";
    const bytes = new Uint32Array(length);
    crypto.getRandomValues(bytes);
    return Array.from(bytes, (n) => chars[n % chars.length]).join("");
  }

  // ---------- audit log texts
  const AUDIT = {
    login_ok: ["Signed in", ""],
    login_failed: ["Failed sign-in", "bad"],
    login_blocked: ["Sign-in blocked", "bad"],
    login_denied: ["Sign-in refused", "bad"],
    admin_created: ["Admin created", "ok"],
    admin_updated: ["Admin changed", "warn"],
    admin_enabled: ["Admin unblocked", "ok"],
    admin_disabled: ["Admin blocked", "bad"],
    admin_password_reset: ["Password reset", "warn"],
    admin_deleted: ["Admin deleted", "bad"],
    root_created: ["Root created", "ok"],
    root_updated: ["Root updated", "warn"],
    root_disabled: ["Root disabled", "bad"],
    user_blocked: ["User blocked", "bad"],
    user_unblocked: ["User unblocked", "ok"],
    user_deleted: ["User deleted", "bad"],
    project_archived: ["Project archived", "warn"],
    project_restored: ["Project restored", "ok"],
    project_suspended: ["Project suspended", "bad"],
    project_unsuspended: ["Project unsuspended", "ok"],
    project_deleted: ["Project deleted", "bad"],
    page_created: ["Page created", "ok"],
    page_updated: ["Page changed", "warn"],
    page_published: ["Page published", "ok"],
    page_unpublished: ["Page unpublished", "warn"],
    page_deleted: ["Page deleted", "bad"],
  };
  const auditLabel = (action) => (AUDIT[action] ? AUDIT[action][0] : String(action));
  const auditTone = (action) => (AUDIT[action] ? AUDIT[action][1] : "");

  const FIELD_NAMES = { display_name: "Name", is_active: "Status", username: "Username", password: "Password", enabled: "Enabled" };
  for (const p of PERMS) FIELD_NAMES[p.key] = p.label;
  const fieldName = (key) => FIELD_NAMES[key] || key;

  // one short line for the Details column
  function auditDetails(entry) {
    const d = entry.details;
    if (!d) return "";
    if (d.changed && !Array.isArray(d.changed) && typeof d.changed === "object") {
      return Object.entries(d.changed).filter(([k]) => k !== "is_active").map(([k, v]) => {
        const pair = Array.isArray(v) ? v : [null, v];
        if (typeof pair[1] === "boolean") return `${fieldName(k)}: ${pair[1] ? "on" : "off"}`;
        return `${fieldName(k)}: "${pair[0]}" → "${pair[1]}"`;
      }).join("; ");
    }
    if (Array.isArray(d.changed)) return "Changed: " + d.changed.map(fieldName).join(", ");
    if (entry.action === "admin_created") {
      const names = (d.permissions || []).map(fieldName);
      return (d.display_name ? `Name: "${d.display_name}". ` : "") + (names.length ? "Permissions: " + names.join(", ") : "No permissions");
    }
    if (entry.target_type === "page" && d.title) return `Title: "${d.title}"`;
    if (entry.target_type === "project") {
      return [d.key ? `Key: ${d.key}` : "", d.reason ? `Reason: ${d.reason}` : "",
              d.tickets !== undefined ? `${d.tickets} ticket(s) removed` : ""].filter(Boolean).join(". ");
    }
    if (entry.target_type === "user" && d.full_name) return `User: "${d.full_name}"`;
    if (entry.action === "login_failed") return d.locked ? "Account is locked now" : "Wrong password or unknown user";
    if (d.reason === "locked") return "Too many failed attempts";
    if (d.reason === "disabled") return "Account is blocked";
    if (d.reason) return String(d.reason);
    return JSON.stringify(d);
  }

  return { PERMS, fmt, fmtDate, initials, generatePassword, auditLabel, auditTone, auditDetails };
})();
