/* ============================================================
   Rapid Task — WYSIWYG description editor.
   The text is formatted while you type (bold looks bold, lists look like lists),
   but the value that is stored and sent to the server is Markdown.
   - markdown -> HTML: marked + DOMPurify (js/markdown.js);  HTML -> markdown: turndown (+ gfm plugin)
   - toolbar, hotkeys (Ctrl+B, Ctrl+I ...) and Markdown shortcuts while typing (# , - , 1. , > , **bold** ...)
   - files that are pasted or dropped are not handled here: the editor emits "files"
   - v-model = markdown string.
   ============================================================ */
(function () {
  const MEDIA_RE = /^!\[([^\]\n]*)\]\((\/uploads\/[A-Za-z0-9_.-]+)\)$/;
  let service = null;

  const escHtml = (v) => String(v).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

  // "ol pe" finds "Olena Petrenko": the typed text must start the full name or any word of it
  function nameMatches(name, query) {
    const q = String(query || "").toLowerCase();
    if (!q) return true;
    const words = String(name || "").toLowerCase().split(/\s+/);
    return words.some((_w, i) => words.slice(i).join(" ").startsWith(q));
  }

  function ready() {
    return typeof TurndownService !== "undefined" && window.RTMarkdown && RTMarkdown.ready();
  }

  function turndown() {
    if (service) return service;
    service = new TurndownService({
      headingStyle: "atx", bulletListMarker: "-", codeBlockStyle: "fenced", emDelimiter: "*",
      strongDelimiter: "**", hr: "---",
    });
    if (typeof turndownPluginGfm !== "undefined") service.use(turndownPluginGfm.gfm);
    service.addRule("lineBreak", { filter: "br", replacement: () => "\n" });
    service.addRule("strike", { filter: ["del", "s", "strike"], replacement: (c) => `~~${c}~~` });
    // snake_case inside a word needs no escaping
    const baseEscape = service.escape.bind(service);
    service.escape = (text) => baseEscape(text).replace(/(\w)\\_(?=\w)/g, "$1_");
    // any <pre> is a fenced block; its text is taken as it is
    service.addRule("preBlock", {
      filter: "pre",
      replacement: (_c, node) => "\n\n```\n" + node.textContent.replace(/\u200b/g, "").replace(/\n$/, "") + "\n```\n\n",
    });
    // a mention chip is saved as @[Full Name](user:ID)
    service.addRule("mention", {
      filter: (n) => n.nodeName === "SPAN" && n.classList.contains("mention") && /^\d+$/.test(n.getAttribute("data-user-id") || ""),
      replacement: (_c, n) => `@[${(n.textContent || "").replace(/^@/, "").replace(/[\[\]\n]/g, " ").trim()}](user:${n.getAttribute("data-user-id")})`,
    });
    // uploaded files keep the token form: ![name](/uploads/file)
    service.addRule("uploadImage", {
      filter: (n) => n.nodeName === "IMG" && (n.getAttribute("src") || "").startsWith("/uploads/"),
      replacement: (_c, n) => `![${n.getAttribute("alt") || ""}](${n.getAttribute("src")})`,
    });
    service.addRule("uploadVideo", {
      filter: (n) => n.nodeName === "VIDEO",
      replacement: (_c, n) => `![${n.getAttribute("data-alt") || "video"}](${n.getAttribute("src")})`,
    });
    service.addRule("uploadFile", {
      filter: (n) => n.nodeName === "A" && n.classList.contains("desc-file"),
      replacement: (_c, n) => `![${(n.textContent || "").replace(/^📎\s*/, "").replace(/[\[\]\n]/g, "")}](${n.getAttribute("href")})`,
    });
    return service;
  }

  function toMarkdown(root) {
    const copy = root.cloneNode(true);
    // the "checked" property is not in the markup: copy it
    const live = root.querySelectorAll("input[type=checkbox]");
    copy.querySelectorAll("input[type=checkbox]").forEach((c, i) => {
      if (live[i] && live[i].checked) c.setAttribute("checked", ""); else c.removeAttribute("checked");
    });
    copy.querySelectorAll("video").forEach((v) => v.removeAttribute("controls"));
    // the browser's "indent" puts a list straight into a list: move it into the item before it
    Array.from(copy.querySelectorAll("ul > ul, ul > ol, ol > ul, ol > ol")).reverse().forEach((sub) => {
      let prev = sub.previousElementSibling;
      if (!prev || prev.nodeName !== "LI") {
        prev = copy.ownerDocument.createElement("li");
        sub.parentNode.insertBefore(prev, sub);
      }
      prev.appendChild(sub);
    });
    copy.querySelectorAll("pre br").forEach((br) => br.replaceWith("\n"));
    const md = turndown().turndown(copy.innerHTML)
      .replace(/\u200b/g, "")
      .replace(/\n{3,}/g, "\n\n")
      .trim();
    return tidyLists(md);
  }

  // turndown writes "-   item" and "1.  item"; "- item" and "1. item" are the usual form (code blocks are left alone)
  function tidyLists(md) {
    let inCode = false;
    return md.split("\n").map((line) => {
      if (/^```/.test(line)) { inCode = !inCode; return line; }
      if (inCode) return line;
      return line.replace(/^(\s*)([-*+]|\d+\.)\s{2,}/, "$1$2 ").replace(/^(\s*(?:[-*+]|\d+\.) \[[ xX]\])\s{2,}/, "$1 ");
    }).join("\n");
  }

  const BLOCK_SHORTCUTS = [
    [/^#$/, () => ["formatBlock", "h1"]],
    [/^##$/, () => ["formatBlock", "h2"]],
    [/^###$/, () => ["formatBlock", "h3"]],
    [/^[-*+]$/, () => ["insertUnorderedList"]],
    [/^1[.)]$/, () => ["insertOrderedList"]],
    [/^>$/, () => ["formatBlock", "blockquote"]],
    [/^(\[\]|\[ \])$/, () => ["task"]],
  ];

  const INLINE_SHORTCUTS = [
    [/\*\*([^*\s](?:[^*]*[^*\s])?)\*\*$/, "strong"],
    [/(?:^|[^*])\*([^*\s](?:[^*]*[^*\s])?)\*$/, "em"],
    [/~~([^~\s](?:[^~]*[^~\s])?)~~$/, "del"],
    [/`([^`\s](?:[^`]*[^`\s])?)`$/, "code"],
  ];

  const RichEditor = {
    name: "RichEditor",
    props: {
      modelValue: { type: String, default: "" },
      placeholder: { type: String, default: "" },
      autofocus: { type: Boolean, default: false },
      testid: { type: String, default: "desc-editor" },
      members: { type: Array, default: () => [] },       // users that can be mentioned with @
    },
    emits: ["update:modelValue", "files"],
    data() {
      return {
        active: {}, linkOpen: false, linkUrl: "", empty: true, lang: 0,
        mention: { open: false, items: [], index: 0, left: 0, top: 0 },
      };
    },
    mounted() {
      try { document.execCommand("defaultParagraphSeparator", false, "div"); } catch (_) { /* old browsers */ }
      this.setContent(this.modelValue);
      this.onSelection = () => this.updateActive();
      document.addEventListener("selectionchange", this.onSelection);
      if (this.autofocus) this.focus(true);
    },
    beforeUnmount() { document.removeEventListener("selectionchange", this.onSelection); },
    watch: {
      modelValue(v) {
        if (v !== this.lastEmitted) this.setContent(v);      // changed from outside, not by typing
      },
    },
    methods: {
      i18nGet(key) { void this.lang; return i18nGet(key); },

      // ---------- content <-> markdown ----------
      setContent(md) {
        const el = this.$refs.content;
        el.innerHTML = md ? RTMarkdown.render(md, { keys: false }) : "<div><br></div>";   // always start in a block
        el.querySelectorAll("input[type=checkbox]").forEach((c) => c.removeAttribute("disabled"));
        el.querySelectorAll("video").forEach((v) => v.setAttribute("controls", ""));
        el.querySelectorAll(".mention").forEach((m) => m.setAttribute("contenteditable", "false"));
        RTMarkdown.markMentions(el);
        this.lastEmitted = md || "";
        this.updateEmpty();
      },
      emitValue() {
        const md = toMarkdown(this.$refs.content);
        this.lastEmitted = md;
        this.updateEmpty();
        this.$emit("update:modelValue", md);
      },
      updateEmpty() {
        const el = this.$refs.content;
        this.empty = !el.textContent.replace(/\u200b/g, "").trim() && !el.querySelector("img, video, hr, li, pre, table");
      },

      focus(toEnd = false) {
        const el = this.$refs.content;
        el.focus();
        if (toEnd) {
          const r = document.createRange();
          r.selectNodeContents(el);
          r.collapse(false);
          const sel = window.getSelection();
          sel.removeAllRanges();
          sel.addRange(r);
        }
      },
      inside(node) { return !!node && this.$refs.content.contains(node); },
      selection() {
        const sel = window.getSelection();
        return sel && sel.rangeCount && this.inside(sel.anchorNode) ? sel : null;
      },
      rememberRange() {
        const sel = this.selection();
        if (sel) this.saved = sel.getRangeAt(0).cloneRange();
      },
      restoreRange() {
        this.focus();
        if (this.saved) {
          const sel = window.getSelection();
          sel.removeAllRanges();
          sel.addRange(this.saved);
        }
      },

      // ---------- commands ----------
      exec(cmd, value) {
        this.focus();
        document.execCommand(cmd, false, value);
        this.afterChange();
      },
      afterChange() {
        this.emitValue();
        this.updateActive();
      },
      toggleBlock(tag) {
        const current = this.blockTag();
        this.exec("formatBlock", current === tag ? "p" : tag);
      },
      blockTag() {
        const sel = this.selection();
        if (!sel) return "";
        let n = sel.anchorNode;
        while (n && n !== this.$refs.content) {
          if (n.nodeType === 1 && /^(H[1-6]|BLOCKQUOTE|PRE|P|DIV|LI)$/.test(n.nodeName)) return n.nodeName.toLowerCase();
          n = n.parentNode;
        }
        return "";
      },
      closest(sel) {
        const s = this.selection();
        if (!s) return null;
        let n = s.anchorNode;
        if (n && n.nodeType === 3) n = n.parentNode;
        const found = n && n.closest ? n.closest(sel) : null;
        return found && this.$refs.content.contains(found) ? found : null;
      },
      // inline code has no execCommand: wrap or unwrap the selection
      toggleCode() {
        this.focus();
        const code = this.closest("code");
        const sel = window.getSelection();
        if (code) {
          code.replaceWith(...code.childNodes);
        } else if (sel.rangeCount && !sel.isCollapsed) {
          const el = document.createElement("code");
          el.appendChild(sel.getRangeAt(0).extractContents());
          sel.getRangeAt(0).insertNode(el);
          const r = document.createRange();
          r.setStartAfter(el); r.collapse(true);
          sel.removeAllRanges(); sel.addRange(r);
        } else {
          this.insertInline("code", "");
        }
        this.afterChange();
      },
      toggleTask() {
        this.focus();
        let li = this.closest("li");
        if (!li) { document.execCommand("insertUnorderedList"); li = this.closest("li"); }
        if (!li) return;
        const sel = window.getSelection();
        const keepNode = sel.rangeCount && li.contains(sel.anchorNode) && sel.anchorNode.nodeType === 3 ? sel.anchorNode : null;
        const keepOffset = sel.anchorOffset;
        const box = li.querySelector(":scope > input[type=checkbox]");
        if (box) {
          box.remove();
        } else {
          const c = document.createElement("input");
          c.type = "checkbox";
          li.insertBefore(c, li.firstChild);
        }
        // the browser keeps the caret before the new checkbox: put it back where the text is
        const r = document.createRange();
        if (keepNode && keepNode.isConnected) r.setStart(keepNode, keepOffset);
        else { r.selectNodeContents(li); r.collapse(false); }
        r.collapse(true);
        sel.removeAllRanges(); sel.addRange(r);
        this.afterChange();
      },
      insertInline(tag, text) {          // a new inline element at the caret; the caret goes after it
        const sel = window.getSelection();
        const el = document.createElement(tag);
        el.textContent = text || "\u200b";
        const r = sel.getRangeAt(0);
        r.deleteContents();
        r.insertNode(el);
        const tail = document.createTextNode("\u200b");
        el.after(tail);
        const nr = document.createRange();
        if (text) { nr.setStart(tail, 1); nr.collapse(true); } else { nr.setStart(el.firstChild, 1); nr.collapse(true); }
        sel.removeAllRanges(); sel.addRange(nr);
      },
      insertHr() { this.exec("insertHorizontalRule"); },

      // ---------- links ----------
      openLink() {
        this.rememberRange();
        const a = this.closest("a");
        this.linkUrl = a ? a.getAttribute("href") || "" : "";
        this.linkOpen = true;
        this.$nextTick(() => this.$refs.linkInput && this.$refs.linkInput.focus());
      },
      applyLink() {
        let url = (this.linkUrl || "").trim();
        this.linkOpen = false;
        this.restoreRange();
        if (!url) { this.exec("unlink"); return; }
        if (/^[A-Za-z][A-Za-z0-9]{1,14}-\d+$/.test(url)) url = `/ticket.html?key=${encodeURIComponent(url.toUpperCase())}`;
        else if (!/^(https?:\/\/|mailto:|\/ticket\.html\?|\/uploads\/|#)/i.test(url)) url = "https://" + url;
        const sel = window.getSelection();
        if (sel.isCollapsed) document.execCommand("insertHTML", false, `<a href="${url.replace(/"/g, "&quot;")}">${url.replace(/[<>&]/g, "")}</a>&#8203;`);
        else document.execCommand("createLink", false, url);
        this.afterChange();
      },
      closeLink() { this.linkOpen = false; this.restoreRange(); },
      unlink() { this.exec("unlink"); },

      // ---------- media inserted by the dialog (token = ![name](/uploads/file)) ----------
      insertToken(token) {
        const m = MEDIA_RE.exec(token.trim());
        if (!m) return;
        this.restoreRange();
        const html = RTMarkdown.render(token, { keys: false });
        document.execCommand("insertHTML", false, html + "<p><br></p>");
        this.$refs.content.querySelectorAll("video:not([controls])").forEach((v) => v.setAttribute("controls", ""));
        this.afterChange();
      },

      // ---------- events ----------
      onInput(e) {
        this.rememberRange();
        if (e.inputType === "insertText" && e.data && /[*~`]/.test(e.data)) this.inlineShortcut();
        this.emitValue();
        this.updateMention();
        this.updateActive();
      },

      // ---------- @mentions ----------
      closeMention() { if (this.mention.open) this.mention.open = false; },
      // "@" at the start or after a space + some letters: show the members whose name fits.
      // No member fits, or Esc: no dropdown, and the typed text stays plain text.
      updateMention() {
        const sel = this.selection();
        if (!this.members.length || !sel || !sel.isCollapsed || sel.anchorNode.nodeType !== 3) return this.closeMention();
        const node = sel.anchorNode;
        if (node.parentElement.closest("code, pre, a, .mention")) return this.closeMention();
        const before = node.nodeValue.slice(0, sel.anchorOffset);
        const m = /(^|[\s\u200b\u00a0])@([^@\n]{0,40})$/.exec(before);
        if (!m) { this.mentionOff = null; return this.closeMention(); }
        const start = before.length - m[2].length - 1;                 // position of the "@"
        if (this.mentionOff && this.mentionOff.node === node && this.mentionOff.start === start) return this.closeMention();
        const items = this.members
          .filter((u) => u.is_active !== false && nameMatches(u.full_name, m[2]))
          .slice(0, 8);
        if (!items.length) return this.closeMention();
        const r = document.createRange();
        r.setStart(node, start); r.setEnd(node, start + 1);
        const rect = r.getBoundingClientRect(), box = this.$el.getBoundingClientRect();
        this.mentionAt = { node, start, end: sel.anchorOffset };
        this.mention = {
          open: true, items, index: 0,
          left: Math.max(0, Math.min(rect.left - box.left, box.width - 260)),
          top: rect.bottom - box.top + 4,
        };
      },
      // keys while the dropdown is open; returns true when the key was used
      mentionKey(e) {
        const n = this.mention.items.length;
        if (e.isComposing || e.ctrlKey || e.metaKey || e.altKey) return false;
        if (e.key === "ArrowDown" || e.key === "ArrowUp") {
          e.preventDefault();
          this.mention.index = (this.mention.index + (e.key === "ArrowDown" ? 1 : n - 1)) % n;
          return true;
        }
        if (e.key === "Enter" || e.key === "Tab") {
          e.preventDefault();
          this.pickMention(this.mention.items[this.mention.index]);
          return true;
        }
        if (e.key === "Escape") {
          e.preventDefault(); e.stopPropagation();                      // close the dropdown, not the dialog
          this.mentionOff = this.mentionAt ? { node: this.mentionAt.node, start: this.mentionAt.start } : null;
          this.closeMention();
          return true;
        }
        return false;
      },
      pickMention(user) {
        const at = this.mentionAt, sel = this.selection();
        this.closeMention();
        if (!user || !at || !at.node.isConnected || !sel) return;
        const r = document.createRange();
        r.setStart(at.node, at.start);
        r.setEnd(at.node, Math.min(at.end, at.node.nodeValue.length));
        sel.removeAllRanges(); sel.addRange(r);
        const name = String(user.full_name).replace(/[\[\]\n]/g, " ").trim();
        document.execCommand("insertHTML", false,
          `<span class="mention" data-user-id="${Number(user.id)}" contenteditable="false">@${escHtml(name)}</span> \u200b`);
      },
      // **bold**, *italic*, ~~strike~~ and `code` typed with the Markdown characters
      inlineShortcut() {
        const sel = this.selection();
        if (!sel || !sel.isCollapsed || sel.anchorNode.nodeType !== 3) return;
        if (sel.anchorNode.parentElement.closest("code, pre")) return;
        const node = sel.anchorNode, offset = sel.anchorOffset;
        const before = node.nodeValue.slice(0, offset);
        for (const [re, tag] of INLINE_SHORTCUTS) {          // (a zero-width mark inside the text does not matter: the patterns stop at it)
          const m = re.exec(before);
          if (!m) continue;
          const inner = m[1];
          const whole = tag === "em" ? m[0].slice(m[0].indexOf("*")) : m[0];
          const start = offset - whole.length;
          const r = document.createRange();
          r.setStart(node, start); r.setEnd(node, offset);
          r.deleteContents();
          const el = document.createElement(tag);
          el.textContent = inner;
          r.insertNode(el);
          const tail = document.createTextNode("\u200b");
          el.after(tail);
          const nr = document.createRange();
          nr.setStart(tail, 1); nr.collapse(true);
          sel.removeAllRanges(); sel.addRange(nr);
          return;
        }
      },
      onKeydown(e) {
        if (this.mention.open && this.mentionKey(e)) return;
        const mod = e.ctrlKey || e.metaKey;
        const key = e.key.toLowerCase();
        if (mod && !e.altKey) {
          const map = { b: () => this.exec("bold"), i: () => this.exec("italic"), u: null,
            e: () => this.toggleCode(), k: () => this.openLink() };
          if (!e.shiftKey && map[key]) { e.preventDefault(); map[key](); return; }
          if (e.shiftKey && key === "x") { e.preventDefault(); this.exec("strikeThrough"); return; }
          if (e.shiftKey && (e.code === "Digit7" || key === "&")) { e.preventDefault(); this.exec("insertOrderedList"); return; }
          if (e.shiftKey && (e.code === "Digit8" || key === "*")) { e.preventDefault(); this.exec("insertUnorderedList"); return; }
          if (e.shiftKey && (e.code === "Digit9" || key === "(")) { e.preventDefault(); this.toggleTask(); return; }
          if (e.shiftKey && key === "q") { e.preventDefault(); this.toggleBlock("blockquote"); return; }
          if (e.shiftKey && key === "c") { e.preventDefault(); this.toggleBlock("pre"); return; }
          if (key === "y") { e.preventDefault(); this.exec("redo"); return; }
          if (key === "z") { e.preventDefault(); this.exec(e.shiftKey ? "redo" : "undo"); return; }
        }
        if (mod && e.altKey && /^[0-3]$/.test(e.key)) {
          e.preventDefault();
          this.exec("formatBlock", e.key === "0" ? "p" : "h" + e.key);
          return;
        }
        if (e.key === " " && !mod) { if (this.blockShortcut(e)) return; }
        if (e.key === "Enter" && !mod) {
          if (!e.shiftKey && (this.fenceShortcut(e) || this.exitEmptyBlock(e))) return;
          if (this.closest("pre")) {                // a new line inside a code block stays in the same block
            e.preventDefault();
            this.newLineInCode();
            return;
          }
        }
        if (e.key === "Tab") {
          const li = this.closest("li");
          if (li) { e.preventDefault(); this.moveItem(li, e.shiftKey); }
        }
      },
      // Tab / Shift+Tab in a list: nest the item under the item before it, or lift it out (own code: the browser's
      // "indent" turns a plain item into a quote)
      moveItem(li, out) {
        const sel = this.selection();
        const range = sel && sel.rangeCount ? sel.getRangeAt(0).cloneRange() : null;
        const list = li.parentNode;
        if (!out) {
          const prev = li.previousElementSibling;
          if (!prev || prev.nodeName !== "LI") return;              // the first item cannot be nested
          let sub = Array.from(prev.children).reverse().find((c) => c.nodeName === "UL" || c.nodeName === "OL");
          if (!sub) { sub = document.createElement(list.nodeName.toLowerCase()); prev.appendChild(sub); }
          sub.appendChild(li);
        } else {
          const parentLi = list.parentNode;
          if (!parentLi || parentLi.nodeName !== "LI") return;      // already at the top level
          const after = [];
          for (let n = li.nextElementSibling; n; n = n.nextElementSibling) after.push(n);
          if (after.length) {                                      // the items below stay under this item
            let sub = Array.from(li.children).find((c) => c.nodeName === list.nodeName);
            if (!sub) { sub = document.createElement(list.nodeName.toLowerCase()); li.appendChild(sub); }
            after.forEach((n) => sub.appendChild(n));
          }
          parentLi.parentNode.insertBefore(li, parentLi.nextSibling);
          if (!list.children.length) list.remove();
        }
        if (range && sel) { sel.removeAllRanges(); sel.addRange(range); }
        this.emitValue();
      },
      // "# " "- " "1. " "> " "[] " at the start of an empty-looking block turn the block into a heading, list ...
      blockShortcut(e) {
        const sel = this.selection();
        if (!sel || !sel.isCollapsed || sel.anchorNode.nodeType !== 3) return false;
        const clean = (t) => t.replace(/\u200b/g, "");           // zero-width marks are left by earlier shortcuts
        const text = clean(sel.anchorNode.nodeValue.slice(0, sel.anchorOffset));
        if (clean(sel.anchorNode.nodeValue) !== text) return false;      // the caret is not at the end of the text
        if (this.closest("pre, code")) return false;
        // the marker must be alone on its line: its neighbours are only block elements (or nothing)
        const isBlock = (n) => !n || (n.nodeType === 1 && /^(UL|OL|DIV|P|H[1-6]|BLOCKQUOTE|PRE|TABLE|HR|BR)$/.test(n.nodeName));
        const node = sel.anchorNode;
        if (!isBlock(node.previousSibling) || !isBlock(node.nextSibling)) return false;
        for (const [re, make] of BLOCK_SHORTCUTS) {
          if (!re.test(text)) continue;
          e.preventDefault();
          this.blankOut(sel);
          const [cmd, arg] = make();
          if (cmd === "task") this.toggleTask(); else this.exec(cmd, arg);
          return true;
        }
        return false;
      },
      // insertText("\n") would split the <pre>: put the line break into the text ourselves
      newLineInCode() {
        const sel = window.getSelection();
        const r = sel.getRangeAt(0);
        r.deleteContents();
        const node = document.createTextNode("\n\u200b");        // the zero-width mark gives the caret a line to stand on
        r.insertNode(node);
        const nr = document.createRange();
        nr.setStart(node, 2); nr.collapse(true);
        sel.removeAllRanges(); sel.addRange(nr);
        this.afterChange();
      },
      // remove the typed marker, but keep a zero-width character so that the block (and the caret) stays alive
      blankOut(sel) {
        const node = sel.anchorNode;
        node.nodeValue = "\u200b";
        const r = document.createRange();
        r.setStart(node, 1); r.collapse(true);
        sel.removeAllRanges(); sel.addRange(r);
      },
      // Enter on an empty list item / quote line / after an empty code line leaves the list, quote or code block
      exitEmptyBlock(e) {
        const sel = this.selection();
        if (!sel || !sel.isCollapsed) return false;
        const blank = (n) => !n.textContent.replace(/\u200b/g, "").trim() && !n.querySelector("img, video");
        const li = this.closest("li");
        if (li && blank(li)) {
          e.preventDefault();
          li.querySelectorAll(":scope > input[type=checkbox]").forEach((c) => c.remove());
          this.exec(li.parentElement.nodeName === "OL" ? "insertOrderedList" : "insertUnorderedList");
          return true;
        }
        const bq = this.closest("blockquote");
        if (bq) {
          let line = sel.anchorNode.nodeType === 3 ? sel.anchorNode.parentElement : sel.anchorNode;
          while (line && line.parentElement !== bq && line !== bq) line = line.parentElement;
          if (line && line !== bq && blank(line)) { e.preventDefault(); this.exec("outdent"); return true; }
          if (line === bq && blank(bq)) { e.preventDefault(); this.exec("formatBlock", "div"); return true; }
        }
        const pre = this.closest("pre");
        if (pre && /\n$/.test(pre.textContent.replace(/\u200b/g, ""))) {
          e.preventDefault();
          pre.textContent = pre.textContent.replace(/\u200b/g, "").replace(/\n+$/, "");
          const next = document.createElement("div");
          next.innerHTML = "<br>";
          pre.after(next);
          const r = document.createRange();
          r.setStart(next, 0); r.collapse(true);
          sel.removeAllRanges(); sel.addRange(r);
          this.afterChange();
          return true;
        }
        return false;
      },
      fenceShortcut(e) {
        const sel = this.selection();
        if (!sel || !sel.isCollapsed || sel.anchorNode.nodeType !== 3) return false;
        if (sel.anchorNode.nodeValue.replace(/\u200b/g, "").trim() !== "```") return false;
        e.preventDefault();
        this.blankOut(sel);
        this.exec("formatBlock", "pre");
        return true;
      },
      onChange(e) {                          // a task checkbox was clicked
        if (e.target && e.target.type === "checkbox") {
          if (e.target.checked) e.target.setAttribute("checked", ""); else e.target.removeAttribute("checked");
          this.emitValue();
        }
      },
      onPaste(e) {
        const files = Array.from((e.clipboardData && e.clipboardData.files) || []);
        if (files.length) { e.preventDefault(); this.$emit("files", files); return; }
        const text = e.clipboardData && e.clipboardData.getData("text/plain");
        if (!text) return;
        e.preventDefault();
        // pasted Markdown becomes formatted text; one plain line stays plain
        if (/\n/.test(text) || /^(#{1,6} |[-*+] |\d+[.)] |> |```)/.test(text) || /(\*\*|`|\[.+\]\(.+\))/.test(text)) {
          document.execCommand("insertHTML", false, RTMarkdown.render(text, { keys: false }));
          this.$refs.content.querySelectorAll("input[type=checkbox]").forEach((c) => c.removeAttribute("disabled"));
        } else {
          document.execCommand("insertText", false, text);
        }
        this.afterChange();
      },
      onDrop(e) {
        const files = Array.from((e.dataTransfer && e.dataTransfer.files) || []);
        if (files.length) { e.preventDefault(); this.$emit("files", files); }
      },
      onBlur() { this.rememberRange(); this.closeMention(); },
      updateActive() {
        if (!this.selection()) return;
        const q = (c) => { try { return document.queryCommandState(c); } catch (_) { return false; } };
        this.active = {
          bold: q("bold"), italic: q("italic"), strike: q("strikeThrough"),
          code: !!this.closest("code"), ul: q("insertUnorderedList"), ol: q("insertOrderedList"),
          quote: this.blockTag() === "blockquote", pre: !!this.closest("pre"),
          h1: this.blockTag() === "h1", h2: this.blockTag() === "h2", link: !!this.closest("a"),
        };
      },
    },
    template: `
    <div class="rte" :data-testid="testid + '-box'">
      <div class="rte-toolbar" role="toolbar" @mousedown.prevent>
        <button type="button" class="rte-btn" :class="{ on: active.bold }" data-cmd="bold" :title="i18nGet('rte.bold')" @click="exec('bold')"><b>B</b></button>
        <button type="button" class="rte-btn" :class="{ on: active.italic }" data-cmd="italic" :title="i18nGet('rte.italic')" @click="exec('italic')"><i>I</i></button>
        <button type="button" class="rte-btn" :class="{ on: active.strike }" data-cmd="strike" :title="i18nGet('rte.strike')" @click="exec('strikeThrough')"><s>S</s></button>
        <button type="button" class="rte-btn" :class="{ on: active.code }" data-cmd="code" :title="i18nGet('rte.code')" @click="toggleCode">&lt;/&gt;</button>
        <span class="rte-sep"></span>
        <button type="button" class="rte-btn" :class="{ on: active.h1 }" data-cmd="h1" :title="i18nGet('rte.h1')" @click="toggleBlock('h1')">H1</button>
        <button type="button" class="rte-btn" :class="{ on: active.h2 }" data-cmd="h2" :title="i18nGet('rte.h2')" @click="toggleBlock('h2')">H2</button>
        <span class="rte-sep"></span>
        <button type="button" class="rte-btn" :class="{ on: active.ul }" data-cmd="ul" :title="i18nGet('rte.ul')" @click="exec('insertUnorderedList')">•≡</button>
        <button type="button" class="rte-btn" :class="{ on: active.ol }" data-cmd="ol" :title="i18nGet('rte.ol')" @click="exec('insertOrderedList')">1.</button>
        <button type="button" class="rte-btn" data-cmd="task" :title="i18nGet('rte.task')" @click="toggleTask">☑</button>
        <button type="button" class="rte-btn" :class="{ on: active.quote }" data-cmd="quote" :title="i18nGet('rte.quote')" @click="toggleBlock('blockquote')">❝</button>
        <button type="button" class="rte-btn" :class="{ on: active.pre }" data-cmd="pre" :title="i18nGet('rte.pre')" @click="toggleBlock('pre')">{ }</button>
        <span class="rte-sep"></span>
        <button type="button" class="rte-btn" :class="{ on: active.link }" data-cmd="link" :title="i18nGet('rte.link')" @click="openLink">🔗</button>
        <button type="button" class="rte-btn" data-cmd="hr" :title="i18nGet('rte.hr')" @click="insertHr">―</button>
        <span class="rte-sep"></span>
        <button type="button" class="rte-btn" data-cmd="undo" :title="i18nGet('rte.undo')" @click="exec('undo')">↶</button>
        <button type="button" class="rte-btn" data-cmd="redo" :title="i18nGet('rte.redo')" @click="exec('redo')">↷</button>
      </div>
      <div class="rte-link" v-if="linkOpen">
        <input class="input" ref="linkInput" v-model="linkUrl" :placeholder="i18nGet('rte.link_ph')" data-testid="rte-link-input"
               @keydown.enter.prevent="applyLink" @keydown.esc.prevent="closeLink">
        <button type="button" class="btn btn-soft btn-sm" data-testid="rte-link-apply" @click="applyLink">OK</button>
        <button type="button" class="btn btn-ghost btn-sm" @click="closeLink">✕</button>
      </div>
      <div class="rte-content md" ref="content" contenteditable="true" role="textbox" aria-multiline="true"
           :class="{ 'is-empty': empty }" :data-placeholder="placeholder" :data-testid="testid"
           @input="onInput" @keydown="onKeydown" @paste="onPaste" @drop="onDrop" @change="onChange"
           @blur="onBlur" @mouseup="rememberRange" @keyup="rememberRange"></div>
      <ul v-if="mention.open" class="mention-menu" role="listbox" data-testid="mention-menu"
          :style="{ left: mention.left + 'px', top: mention.top + 'px' }" @mousedown.prevent>
        <li v-for="(u, i) in mention.items" :key="u.id" class="mention-item" :class="{ on: i === mention.index }"
            role="option" data-testid="mention-item" :data-user-id="u.id"
            @click="pickMention(u)" @mousemove="mention.index = i">
          <span class="mention-name">{{ u.full_name }}</span>
          <span class="mention-sub">{{ u.email }}</span>
        </li>
      </ul>
    </div>`,
  };

  window.RTRich = { ready, toMarkdown, RichEditor };
  window.RichEditor = RichEditor;
})();
