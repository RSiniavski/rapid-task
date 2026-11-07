/* ============================================================
   Rapid Task — a public site page at /p/<slug> (text from the platform admin tool).
   The text is Markdown: it goes through RTMarkdown (sanitized), never as raw HTML.
   The page shows the language of the site; an empty language falls back to the other one.
   ============================================================ */
(function () {
  const $ = (id) => document.getElementById(id);
  const lang = () => localStorage.getItem("rt_lang") || "uk";
  const slug = decodeURIComponent((location.pathname.match(/^\/p\/([^/]+)/) || [])[1] || "").toLowerCase();
  let page = null;

  function pick(field) {
    const l = lang(), other = l === "uk" ? "en" : "uk";
    return (page[field + "_" + l] || "").trim() ? page[field + "_" + l] : (page[field + "_" + other] || "");
  }

  function show(id) {
    ["page-loading", "page-article", "page-missing", "page-error"].forEach((x) => { $(x).hidden = x !== id; });
  }

  function when(iso) {
    if (!iso) return "";
    const d = new Date(/[zZ]|[+-]\d\d:?\d\d$/.test(iso) ? iso : iso + "Z");          // the server sends UTC
    if (isNaN(d)) return "";
    return d.toLocaleString(lang() === "uk" ? "uk-UA" : "en-GB",
      { year: "numeric", month: "short", day: "numeric", hour: "2-digit", minute: "2-digit", hour12: false });
  }

  function render() {
    if (!page) return;
    const title = pick("title") || page.slug;
    $("page-title").textContent = title;
    document.title = title + " — Rapid Task";
    const text = pick("content");
    if (window.RTMarkdown && RTMarkdown.ready()) $("page-body").innerHTML = RTMarkdown.render(text, { keys: false });
    else $("page-body").textContent = text;
    $("page-updated").textContent = page.updated_at ? i18nGet("page.updated") + ": " + when(page.updated_at) : "";
    show("page-article");
  }

  async function load() {
    show("page-loading");
    try {
      const r = await fetch("/api/pages/" + encodeURIComponent(slug));
      if (r.status === 404) { document.title = i18nGet("page.not_found") + " — Rapid Task"; return show("page-missing"); }
      if (!r.ok) throw new Error("HTTP " + r.status);
      page = await r.json();
      render();
    } catch (_) {
      show("page-error");
    }
  }

  document.addEventListener("DOMContentLoaded", () => {
    $("page-retry").addEventListener("click", load);
    document.querySelectorAll(".lang-switch button").forEach((btn) => {
      btn.addEventListener("click", () => setTimeout(() => { render(); if (!page) document.title = i18nGet("page.not_found") + " — Rapid Task"; }, 0));
    });
    load();
  });
})();
