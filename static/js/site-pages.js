/* ============================================================
   Rapid Task — links to the site pages (Donate, Terms, Privacy ... made in the platform admin tool).
   - [data-site-links="footer"|"register"]  gets the links of the published pages that have that flag
   - [data-needs-page="slug"]               stays hidden until that page is published
   Only published pages are public: the server answers 404 for a draft. A failed request shows nothing.
   ============================================================ */
(function () {
  const lang = () => localStorage.getItem("rt_lang") || "uk";
  const titleOf = (p) => {
    const l = lang(), other = l === "uk" ? "en" : "uk";
    return (p["title_" + l] || "").trim() || (p["title_" + other] || "").trim() || p.slug;
  };
  let links = [];

  function renderLinks() {
    document.querySelectorAll("[data-site-links]").forEach((box) => {
      const kind = box.dataset.siteLinks;                          // footer | register
      box.textContent = "";
      links.filter((l) => (kind === "register" ? l.in_register : l.in_footer)).forEach((l) => {
        const a = document.createElement("a");
        a.href = "/p/" + encodeURIComponent(l.slug);
        a.textContent = titleOf(l);
        a.setAttribute("data-testid", "site-link");
        a.dataset.slug = l.slug;
        if (kind === "register") { a.target = "_blank"; a.rel = "noopener"; }      // the form stays open
        box.appendChild(a);
      });
      box.hidden = !box.children.length;
      const wrap = box.closest("[data-site-wrap]");
      if (wrap) wrap.hidden = box.hidden;
    });
  }

  function showWhenPublished() {
    document.querySelectorAll("[data-needs-page]").forEach((el) => {
      fetch("/api/pages/" + encodeURIComponent(el.dataset.needsPage))
        .then((r) => { el.hidden = !r.ok; })
        .catch(() => { el.hidden = true; });
    });
  }

  function load() {
    fetch("/api/pages/links")
      .then((r) => (r.ok ? r.json() : []))
      .catch(() => [])
      .then((rows) => { links = Array.isArray(rows) ? rows : []; renderLinks(); document.dispatchEvent(new CustomEvent("site-links-ready")); });
    showWhenPublished();
  }

  document.addEventListener("DOMContentLoaded", () => {
    load();
    document.querySelectorAll(".lang-switch button").forEach((btn) => {
      btn.addEventListener("click", () => setTimeout(renderLinks, 0));            // after i18n.js has saved the new language
    });
  });
})();
