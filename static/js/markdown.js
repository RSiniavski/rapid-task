/* ============================================================
   Rapid Task — Markdown for ticket descriptions (display side)
   - marked (GFM) turns Markdown into HTML, DOMPurify cleans it
   - raw HTML typed by a user is shown as text, never executed
   - images only from /uploads/, uploads of other kinds are file links
   - smart ticket links: KEY-N becomes a link; after the page shows it, the title is added ("KEY-N · Title")
   - mentions: @[Full Name](user:12) becomes a chip; a user who is not an active member shows as a grey, disabled chip
   If the libraries are not loaded, renderDescription() in shared.js falls back to the old plain renderer.
   ============================================================ */
(function () {
  const IMAGE_EXT = ["png", "jpg", "jpeg", "gif", "webp", "svg", "bmp"];
  const VIDEO_EXT = ["mp4", "webm", "ogg", "mov"];
  const KEY_RE = /\b[A-Z][A-Z0-9]{1,14}-\d+\b/g;
  const ALLOWED_TAGS = ["p", "br", "strong", "b", "em", "i", "del", "s", "code", "pre", "blockquote",
    "ul", "ol", "li", "h1", "h2", "h3", "h4", "h5", "h6", "a", "img", "video", "table", "thead",
    "tbody", "tr", "th", "td", "hr", "input", "span", "div"];
  const ALLOWED_ATTR = ["href", "src", "alt", "title", "class", "controls", "preload", "loading",
    "type", "checked", "disabled", "target", "rel", "align", "start", "data-ticket-key", "data-alt", "data-user-id"];

  const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
  const ext = (url) => (url.split("?")[0].split(".").pop() || "").toLowerCase();

  let configured = false;

  function ready() {
    return typeof marked !== "undefined" && typeof DOMPurify !== "undefined";
  }

  function configure() {
    if (configured || !ready()) return;
    configured = true;
    marked.use({
      gfm: true,
      breaks: true,                      // a single line break stays a line break (old descriptions)
      renderer: {
        html(html) { return esc(html); },            // raw HTML is text
        image(href, title, text) {
          if (typeof href !== "string" || !href.startsWith("/uploads/")) return esc(text || "");
          const e = ext(href);
          if (IMAGE_EXT.includes(e)) return `<img class="desc-media" src="${esc(href)}" alt="${esc(text)}" loading="lazy">`;
          if (VIDEO_EXT.includes(e)) return `<video class="desc-media" src="${esc(href)}" data-alt="${esc(text || "")}" controls preload="metadata"></video>`;
          return `<a class="desc-file" href="${esc(href)}" target="_blank" rel="noopener">📎 ${esc(text || href)}</a>`;
        },
      },
    });
    marked.use({                         // @[Full Name](user:12) -> mention chip (not a link)
      extensions: [{
        name: "mention",
        level: "inline",
        start(src) { return src.indexOf("@["); },
        tokenizer(src) {
          const m = /^@\[([^\]\n]{1,100})\]\(user:(\d{1,12})\)/.exec(src);
          return m ? { type: "mention", raw: m[0], name: m[1], id: m[2] } : undefined;
        },
        renderer(tok) {
          return `<span class="mention" data-user-id="${esc(tok.id)}">@${esc(tok.name)}</span>`;
        },
      }],
    });
    DOMPurify.addHook("afterSanitizeAttributes", (node) => {
      if (node.tagName === "A") {
        let href = node.getAttribute("href") || "";
        if (/^[A-Za-z][A-Za-z0-9]{1,14}-\d+$/.test(href)) {         // [text](TP-21): the address is only a ticket key
          href = `/ticket.html?key=${encodeURIComponent(href.toUpperCase())}`;
          node.setAttribute("href", href);
        }
        if (!/^(https?:\/\/|mailto:|\/ticket\.html\?|\/uploads\/|\/p\/[a-z0-9-]+|#)/i.test(href)) node.removeAttribute("href");
        if (/^https?:\/\//i.test(href) || href.startsWith("/uploads/")) {
          node.setAttribute("target", "_blank");
          node.setAttribute("rel", "noopener noreferrer");
        }
      }
      if (node.tagName === "IMG" && !(node.getAttribute("src") || "").startsWith("/uploads/")) node.remove();
      if (node.tagName === "VIDEO" && !(node.getAttribute("src") || "").startsWith("/uploads/")) node.remove();
      if (node.tagName === "INPUT") {            // only the checkbox of a task list
        if (node.getAttribute("type") !== "checkbox") node.remove();
        else node.setAttribute("disabled", "");
      }
    });
  }

  const KEY_ONE = /^[A-Z][A-Z0-9]{1,14}-\d+$/;

  // links that point to a ticket page of this site (a pasted address or [text](address)) are ticket links too
  function markTicketLinks(root) {
    root.querySelectorAll("a[href]").forEach((a) => {
      let url;
      try { url = new URL(a.getAttribute("href"), location.href); } catch (_) { return; }
      if (url.origin !== location.origin || url.pathname !== "/ticket.html") return;
      const key = (url.searchParams.get("key") || "").toUpperCase();
      if (!KEY_ONE.test(key)) return;
      const shown = a.textContent.trim();
      const auto = shown === a.getAttribute("href") || shown.toUpperCase() === key;   // the text is only the address or the key
      a.className = "tk-ref";
      a.dataset.ticketKey = key;
      if (!auto) a.dataset.keepText = "1";                       // [my words](address): keep my words
      a.setAttribute("href", `/ticket.html?key=${encodeURIComponent(key)}`);
      a.removeAttribute("target");
      a.removeAttribute("rel");
      if (auto) a.textContent = key;
    });
  }

  // KEY-N inside normal text (not in code, not inside a link) becomes <a class="tk-ref">
  function linkTicketKeys(root) {
    markTicketLinks(root);
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    const nodes = [];
    while (walker.nextNode()) nodes.push(walker.currentNode);
    for (const node of nodes) {
      if (node.parentElement && node.parentElement.closest("a, code, pre, .mention")) continue;
      const text = node.nodeValue;
      KEY_RE.lastIndex = 0;
      if (!KEY_RE.test(text)) continue;
      KEY_RE.lastIndex = 0;
      const frag = document.createDocumentFragment();
      let last = 0, m;
      while ((m = KEY_RE.exec(text))) {
        frag.appendChild(document.createTextNode(text.slice(last, m.index)));
        const a = document.createElement("a");
        a.className = "tk-ref";
        a.href = `/ticket.html?key=${encodeURIComponent(m[0])}`;
        a.dataset.ticketKey = m[0];
        a.dataset.fromText = "1";
        a.textContent = m[0];
        frag.appendChild(a);
        last = m.index + m[0].length;
      }
      frag.appendChild(document.createTextNode(text.slice(last)));
      node.parentNode.replaceChild(frag, node);
    }
  }

  // opts.keys === false: no ticket links (the editor shows keys as plain text)
  function render(text, opts) {
    if (!text) return "";
    configure();
    const html = DOMPurify.sanitize(marked.parse(String(text)), {
      ALLOWED_TAGS, ALLOWED_ATTR, ALLOW_DATA_ATTR: false,
    });
    const box = document.createElement("div");
    box.innerHTML = html;
    if (!opts || opts.keys !== false) linkTicketKeys(box);
    return box.innerHTML;
  }

  // ---- ticket titles for the smart links ----
  const titles = new Map();             // KEY -> Promise<{ title } | null>
  function lookup(key) {
    if (!titles.has(key)) {
      titles.set(key, API.ticketByKey(key).then((t) => ({
        title: t.title, type: t.type,
        status: t.column ? t.column.name : "", done: !!(t.column && t.column.is_done),
      })).catch(() => null));
    }
    return titles.get(key);
  }

  const span = (cls, text) => {
    const el = document.createElement("span");
    el.className = cls;
    if (text !== undefined) el.textContent = text;
    return el;
  };

  // the link becomes a small card: [type icon] KEY | title  (status)
  function buildCard(a, key, info) {
    const meta = typeof typeMeta === "function" ? typeMeta(info.type) : { icon: "🎫", colorVar: "--type-task" };
    a.classList.add("tk-card");
    a.classList.toggle("is-done", info.done);
    a.textContent = "";
    const icon = span("tk-card-icon", meta.icon);
    icon.style.setProperty("--chip", `var(${meta.colorVar})`);
    a.append(icon, span("tk-card-key", key), span("tk-card-sep"), span("tk-card-title", info.title));
    if (info.status) {
      const st = span("tk-card-status");
      st.append(span("tk-card-dot"), document.createTextNode(info.status));
      a.append(st);
    }
  }

  // ---- mentions: who is an active member of the project now ----
  let memberMap = null;                 // user id -> is_active; null = not known (every chip stays active)
  function setMembers(members) {
    memberMap = new Map((members || []).map((m) => [String(m.user.id), m.user.is_active !== false]));
  }

  function markMentions(root) {
    root.querySelectorAll(".mention[data-user-id]").forEach((el) => {
      const gone = memberMap !== null && memberMap.get(el.dataset.userId) !== true;
      el.classList.toggle("is-gone", gone);
      if (gone) { el.title = i18nGet("mention.deactivated"); el.dataset.gone = i18nGet("mention.gone"); }
      else { el.removeAttribute("title"); delete el.dataset.gone; }
    });
  }

  // add the titles; a key that is not a ticket (no access, no such ticket) goes back to plain text
  function hydrate(root) {
    if (root) markMentions(root);
    if (!root || typeof API === "undefined" || !API.ticketByKey) return;
    root.querySelectorAll("a.tk-ref[data-ticket-key]:not([data-done])").forEach((a) => {
      a.dataset.done = "1";
      const key = a.dataset.ticketKey;
      lookup(key).then((info) => {
        if (!a.isConnected) return;
        if (!info) {                                    // not a ticket you can open
          if (a.dataset.fromText) a.replaceWith(document.createTextNode(key));   // a key typed in text: plain text again
          return;                                       // a real link stays a link
        }
        a.title = info.title;
        if (!a.dataset.keepText) buildCard(a, key, info);
      });
    });
  }

  window.RTMarkdown = { ready, render, hydrate, setMembers, markMentions, linkTicketKeys, forgetTitles() { titles.clear(); } };
})();
