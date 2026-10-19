// Minifox — content script.
//  * In the mini window: a floating toolbar (back, URL, copy, open in Firefox, close).
//  * Everywhere: Shift+click on a link opens a peek overlay with the same toolbar.
//  * Everywhere: ⌘⇧C copies the page URL.

(() => {
  const PEEK_NAME = "minifox_peek";
  const isTop = window.top === window;
  const inPeek = !isTop && window.name === PEEK_NAME;

  // ⌘ on macOS, Ctrl on Windows/Linux.
  const isMac = /^Mac/.test(navigator.platform);
  const mod = (e) => (isMac ? e.metaKey && !e.ctrlKey : e.ctrlKey && !e.metaKey);
  const isCombo = (e, code) => mod(e) && e.shiftKey && !e.altKey && e.code === code;

  // ----- Report clicks so the background can foreground tabs they open -----
  // A plain click (primary button, no modifiers) or Enter should open a new tab
  // in front; ⌘/Ctrl/Shift/Alt-clicks and middle-clicks should not.
  const reportClick = (plain) =>
    browser.runtime.sendMessage({ type: "userClick", plain }).catch(() => {});

  window.addEventListener("click", (e) => {
    reportClick(e.button === 0 && !e.metaKey && !e.ctrlKey && !e.shiftKey && !e.altKey);
  }, true);
  window.addEventListener("auxclick", () => reportClick(false), true);
  window.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      reportClick(!e.metaKey && !e.ctrlKey && !e.shiftKey && !e.altKey);
    }
  }, true);

  // ----- ⌘⇧C / Ctrl+Shift+C: copy the page URL (runs in every frame) -----
  // Top frame and peek frame copy their own URL; any other iframe copies the
  // tab's URL, not the embedded frame's. The toast is always shown on top.
  window.addEventListener("keydown", async (e) => {
    if (!isCombo(e, "KeyC")) return;
    e.preventDefault();
    e.stopImmediatePropagation();
    try {
      const url = isTop || inPeek
        ? location.href
        : await browser.runtime.sendMessage({ type: "tabUrl" });
      await navigator.clipboard.writeText(url);
      if (isTop) toast("URL copied");
      else browser.runtime.sendMessage({ type: "toast", text: "URL copied" });
    } catch (err) {
      console.error("minifox: copy failed", err);
    }
  }, true);

  // ----- Inside the peek frame: Esc closes the peek, ⌘⇧O opens it in a tab,
  //       "back" goes back here -----
  if (!isTop) {
    if (!inPeek) return;
    window.addEventListener("keydown", (e) => {
      if (e.key === "Escape" && !e.defaultPrevented) {
        browser.runtime.sendMessage({ type: "peekEscape" });
      }
    });
    window.addEventListener("keydown", (e) => {
      if (!isCombo(e, "KeyO")) return;
      e.preventDefault();
      e.stopImmediatePropagation();
      browser.runtime.sendMessage({ type: "openFull" });
    }, true);
    browser.runtime.onMessage.addListener((msg) => {
      if (msg.type === "peekGoBack") history.back();
    });
    return;
  }

  // =====================================================================
  //  Shared UI: theme, icons, toolbar, toast
  // =====================================================================

  const BASE_CSS = `
    :host { all: initial; }
    * { box-sizing: border-box; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }
    :host {
      --bg: #ffffff; --fg: #1d1d1f; --muted: #6e6e73;
      --btn: rgba(0,0,0,.06); --btn-hover: rgba(0,0,0,.11);
      --line: rgba(0,0,0,.09);
      --ok: #34c759; --warn: #d70015;
      --float-shadow: 0 6px 24px rgba(0,0,0,.16), 0 0 0 1px var(--line);
      --panel-shadow: 0 24px 80px rgba(0,0,0,.35), 0 0 0 1px var(--line);
      --glass: color-mix(in srgb, var(--bg) 84%, transparent);
    }
    @media (prefers-color-scheme: dark) {
      :host {
        --bg: #232326; --fg: #f5f5f7; --muted: #a1a1a6;
        --btn: rgba(255,255,255,.08); --btn-hover: rgba(255,255,255,.15);
        --line: rgba(255,255,255,.1);
        --ok: #30d158; --warn: #ff453a;
        --float-shadow: 0 6px 24px rgba(0,0,0,.45), 0 0 0 1px var(--line);
        --panel-shadow: 0 24px 80px rgba(0,0,0,.6), 0 0 0 1px var(--line);
      }
    }

    /* ---- toolbar (mini window + peek) ---- */
    .bar {
      display: flex; align-items: center; gap: 2px;
      height: 40px; padding: 0 6px;
      color: var(--fg); font-size: 12px;
    }
    .btn {
      display: inline-flex; align-items: center; justify-content: center; gap: 6px;
      height: 28px; padding: 0 10px; border: 0; border-radius: 8px; flex: none;
      background: var(--btn); color: var(--fg); font-size: 12px; font-weight: 500;
      cursor: pointer; transition: background .12s;
    }
    .btn:hover { background: var(--btn-hover); }
    .btn.icon { width: 28px; padding: 0; background: transparent; }
    .btn.icon:hover { background: var(--btn); }
    .btn:disabled { opacity: .3; cursor: default; background: transparent; }
    .btn svg { width: 14px; height: 14px; flex: none; }
    .btn .ok { color: var(--ok); }
    .btn.primary { padding-right: 5px; }
    .btn.primary:not(:has(kbd)) { padding-right: 10px; }
    kbd {
      margin-left: 2px; padding: 0 5px; height: 18px; line-height: 16px;
      border: 1px solid var(--line); border-radius: 5px;
      font: 500 11px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      letter-spacing: .04em; color: var(--muted);
    }
    kbd:empty { display: none; }
    .url {
      min-width: 0; padding: 0 8px; border-radius: 7px; line-height: 28px;
      color: var(--muted); white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
      cursor: pointer; transition: background .12s;
    }
    .url:hover { background: var(--btn); }
    .url b { color: var(--fg); font-weight: 600; }
    .url .warn { color: var(--warn); font-weight: 600; margin-right: 6px; }
    .sep { width: 1px; height: 18px; background: var(--line); margin: 0 6px; flex: none; }
  `;

  const ICON = {
    main: `<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M9 2.5h4.5V7"/><path d="M13.5 2.5 7.5 8.5"/><path d="M12 9.5v3a1 1 0 0 1-1 1H3.5a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1h3"/></svg>`,
    mini: `<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"><rect x="2" y="3" width="12" height="10" rx="1.5"/><rect x="8" y="3" width="6" height="5" rx="1" fill="currentColor" stroke="none"/></svg>`,
    close: `<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"><path d="M4 4l8 8M12 4l-8 8"/></svg>`,
    back: `<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M10 3.5 5.5 8l4.5 4.5"/></svg>`,
    copy: `<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"><rect x="5.5" y="5.5" width="8" height="8" rx="1.5"/><path d="M10.5 5.5V4a1.5 1.5 0 0 0-1.5-1.5H4A1.5 1.5 0 0 0 2.5 4v5A1.5 1.5 0 0 0 4 10.5h1.5"/></svg>`,
    check: `<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M3.5 8.5l3 3 6-7"/></svg>`,
  };

  function makeHost() {
    const host = document.createElement("minifox-ui");
    host.style.cssText = "all: initial; position: fixed; z-index: 2147483647;";
    const root = host.attachShadow({ mode: "closed" });
    (document.documentElement || document).appendChild(host);
    return { host, root };
  }

  // Shortcut labels for the current platform ("⌘⇧O" / "Ctrl+Shift+O"),
  // following the user's actual binding for the open-full command.
  const keysPromise = browser.runtime.sendMessage({ type: "keys" }).catch(() => ({}));

  // Toolbar markup shared by the mini window and the peek:
  //   ← | url | copy || primary [kbd] | secondary? | close
  // `data-tip` is the tooltip; `data-key` names the shortcut appended to it
  // (and, on <kbd>, shown as the chip text) once labels arrive.
  function toolbarHTML({ primary, secondary, closeKey }) {
    return `
      <button class="btn icon" data-act="back" data-tip="Back">${ICON.back}</button>
      <div class="url"></div>
      <button class="btn icon" data-act="copy" data-tip="Copy link" data-key="copy">${ICON.copy}</button>
      <span class="sep"></span>
      <button class="btn primary" data-act="${primary.act}" data-tip="${primary.tip}" data-key="openFull">
        ${primary.icon}<span>${primary.label}</span><kbd data-key="openFull"></kbd>
      </button>
      ${secondary
        ? `<button class="btn icon" data-act="${secondary.act}" data-tip="${secondary.tip}">${secondary.icon}</button>`
        : ""}
      <button class="btn icon" data-act="close" data-tip="Close" data-key="${closeKey}">${ICON.close}</button>`;
  }

  async function applyKeys(root) {
    const keys = await keysPromise;
    for (const el of root.querySelectorAll("[data-tip]")) {
      const k = keys[el.dataset.key];
      el.title = k ? `${el.dataset.tip} (${k})` : el.dataset.tip;
    }
    for (const kbd of root.querySelectorAll("kbd[data-key]")) {
      const k = keys[kbd.dataset.key];
      if (k) kbd.textContent = k;
      else kbd.remove(); // shortcut unbound by the user
    }
  }

  // Wire up the parts every toolbar has. Returns helpers to update it.
  function bindToolbar(root, { getUrl, onAction }) {
    applyKeys(root);
    const urlEl = root.querySelector(".url");
    const copyBtn = root.querySelector('[data-act="copy"]');
    const backBtn = root.querySelector('[data-act="back"]');

    const copy = () => copyUrl(getUrl(), copyBtn);
    urlEl.addEventListener("click", copy);
    root.querySelector(".bar").addEventListener("click", (e) => {
      const act = e.target.closest("button")?.dataset.act;
      if (!act) return;
      if (act === "copy") return copy();
      onAction(act);
    });

    return {
      setUrl: (u) => renderUrl(urlEl, u),
      setCanGoBack: (v) => (backBtn.disabled = !v),
    };
  }

  // Render "host/path?query" into el, with the host in bold.
  function renderUrl(el, u) {
    el.textContent = "";
    try {
      const p = new URL(u);
      if (p.protocol === "http:") {
        const w = document.createElement("span");
        w.className = "warn";
        w.textContent = "Not secure";
        el.append(w);
      }
      const b = document.createElement("b");
      b.textContent = p.hostname.replace(/^www\./, "");
      const rest = p.pathname === "/" && !p.search ? "" : p.pathname + p.search;
      el.append(b, document.createTextNode(rest));
    } catch {
      el.textContent = u;
    }
    el.title = `${u}\nClick to copy`;
  }

  // Copy a URL: clipboard + toast, and a check mark on the button if given.
  async function copyUrl(url, btn) {
    try {
      await navigator.clipboard.writeText(url);
    } catch (err) {
      console.error("minifox: copy failed", err);
      return;
    }
    toast("URL copied");
    if (btn) {
      btn.innerHTML = `<span class="ok">${ICON.check}</span>`;
      clearTimeout(btn._reset);
      btn._reset = setTimeout(() => (btn.innerHTML = ICON.copy), 1500);
    }
  }

  // Toast in the bottom-right corner, styled like the toolbars.
  let toastHost;
  function toast(text) {
    toastHost?.remove();
    const { host, root } = makeHost();
    toastHost = host;
    root.innerHTML = `
      <style>${BASE_CSS}
        .toast {
          position: fixed; bottom: 24px; right: 24px;
          display: flex; align-items: center; gap: 8px;
          padding: 8px 14px 8px 9px; border-radius: 11px;
          font-size: 13px; font-weight: 500; color: var(--fg);
          background: var(--glass);
          backdrop-filter: blur(14px) saturate(1.5);
          box-shadow: var(--float-shadow);
          opacity: 0; transform: translateY(6px) scale(.98);
          transition: opacity .15s ease, transform .2s cubic-bezier(.2,.8,.2,1);
          pointer-events: none;
        }
        .toast.show { opacity: 1; transform: none; }
        .badge {
          width: 18px; height: 18px; border-radius: 50%;
          display: grid; place-items: center;
          background: var(--ok); color: #fff;
        }
        .badge svg { width: 11px; height: 11px; }
      </style>
      <div class="toast"><span class="badge">${ICON.check}</span><span class="text"></span></div>`;
    const box = root.querySelector(".toast");
    root.querySelector(".text").textContent = text;
    box.offsetWidth; // force a reflow so the transition runs
    box.classList.add("show");
    setTimeout(() => box.classList.remove("show"), 1500);
    setTimeout(() => host.remove(), 1700);
  }

  browser.runtime.onMessage.addListener((msg) => {
    if (msg.type === "toast") toast(msg.text);
  });

  const onReady = (fn) =>
    document.readyState === "loading"
      ? document.addEventListener("DOMContentLoaded", fn, { once: true })
      : fn();

  // ⌘⇧O fallback (in case Firefox's own shortcut wins over the extension
  // command): in a mini window or with a peek open, "open full". The
  // background dedupes if the command fired as well. Elsewhere the key is
  // left to Firefox.
  let isMiniWindow = false;
  window.addEventListener("keydown", (e) => {
    if (!isCombo(e, "KeyO") || !(peek || isMiniWindow)) return;
    e.preventDefault();
    e.stopImmediatePropagation();
    browser.runtime.sendMessage({ type: "openFull" });
  }, true);

  // =====================================================================
  //  Mini window: floating toolbar
  // =====================================================================

  onReady(async () => {
    try { isMiniWindow = await browser.runtime.sendMessage({ type: "isMini" }); } catch {}
    if (!isMiniWindow) return;

    const { host, root } = makeHost();
    host.style.top = "8px";
    host.style.left = "50%";
    host.style.transform = "translateX(-50%)";

    root.innerHTML = `
      <style>${BASE_CSS}
        .bar {
          max-width: calc(100vw - 16px);
          border-radius: 12px;
          background: var(--glass);
          backdrop-filter: blur(14px) saturate(1.5);
          box-shadow: var(--float-shadow);
          transition: transform .22s cubic-bezier(.2,.8,.2,1), opacity .18s ease;
        }
        .bar.hidden { transform: translateY(-150%); opacity: 0; pointer-events: none; }
        .url { max-width: min(520px, 60vw); }
      </style>
      <div class="bar">${toolbarHTML({
        primary: { act: "main", icon: ICON.main, label: "Open in Firefox", tip: "Open in main window" },
        closeKey: "closeWindow",
      })}</div>`;

    const bar = root.querySelector(".bar");
    const tb = bindToolbar(root, {
      getUrl: () => location.href,
      onAction: (act) => {
        if (act === "back") history.back();
        if (act === "main") browser.runtime.sendMessage({ type: "openInMain" });
        if (act === "close") browser.runtime.sendMessage({ type: "closeMini" });
      },
    });

    // Keep URL and back button in sync, including SPA navigation (pushState etc.).
    let shown = "";
    const sync = () => {
      if (location.href !== shown) tb.setUrl((shown = location.href));
      tb.setCanGoBack(history.length > 1);
    };
    sync();
    setInterval(sync, 500);

    // Auto-hide: hides on scroll down, returns on scroll up or when the
    // pointer approaches the top edge.
    let lastY = window.scrollY;
    let hovering = false;
    const setHidden = (h) => bar.classList.toggle("hidden", h && !hovering);

    window.addEventListener("scroll", () => {
      const y = window.scrollY;
      if (y > lastY + 6 && y > 80) setHidden(true);
      else if (y < lastY - 6 || y < 80) setHidden(false);
      lastY = y;
    }, { passive: true });

    window.addEventListener("mousemove", (e) => {
      if (e.clientY < 56) setHidden(false);
    }, { passive: true });

    bar.addEventListener("mouseenter", () => (hovering = true));
    bar.addEventListener("mouseleave", () => (hovering = false));

    // Get out of the way in fullscreen (videos etc.).
    document.addEventListener("fullscreenchange", () => {
      host.style.display = document.fullscreenElement ? "none" : "";
    });
  });

  // =====================================================================
  //  Peek on Shift+click
  // =====================================================================

  let peek = null;

  const isShiftClick = (e) =>
    e.button === 0 && e.shiftKey && !e.metaKey && !e.ctrlKey && !e.altKey;

  function linkFromEvent(e) {
    const a = e.composedPath().find(
      (el) => el && el.localName === "a" && typeof el.href === "string" && el.href
    );
    if (!a || !/^https?:/.test(a.href) || a.hasAttribute("download")) return null;
    return a;
  }

  // Don't let Shift+mousedown on a link start a text selection.
  document.addEventListener("mousedown", (e) => {
    if (isShiftClick(e) && linkFromEvent(e)) e.preventDefault();
  }, true);

  document.addEventListener("click", (e) => {
    if (!isShiftClick(e)) return;
    const a = linkFromEvent(e);
    if (!a) return;
    e.preventDefault();
    e.stopImmediatePropagation();
    openPeek(a.href);
  }, true);

  // Don't keep a peek around when the page goes into the back-forward cache.
  window.addEventListener("pagehide", () => closePeek(true));

  window.addEventListener("keydown", (e) => {
    if (peek && e.key === "Escape") {
      e.preventDefault();
      e.stopImmediatePropagation();
      closePeek();
    }
  }, true);

  browser.runtime.onMessage.addListener((msg) => {
    if (msg.type === "closePeek") closePeek();
    if (msg.type === "peekNavigated" && peek) peek.update(msg.url, msg.canGoBack);
  });

  async function openPeek(url) {
    closePeek(true);
    try {
      await browser.runtime.sendMessage({ type: "peekOpen", url });
    } catch {
      return;
    }
    peek = buildPeek(url);
  }

  function closePeek(immediate = false) {
    if (!peek) return;
    const p = peek;
    peek = null;
    browser.runtime.sendMessage({ type: "peekClosed" }).catch(() => {});
    p.close(immediate);
  }

  function buildPeek(url) {
    const { host, root } = makeHost();
    host.style.inset = "0";

    root.innerHTML = `
      <style>${BASE_CSS}
        .backdrop {
          position: fixed; inset: 0; background: rgba(0,0,0,.35);
          backdrop-filter: blur(3px); opacity: 0; transition: opacity .18s ease;
        }
        .panel {
          position: fixed; left: 50%; top: 50%;
          width: min(1200px, 92vw); height: 88vh;
          transform: translate(-50%, -48%) scale(.97); opacity: 0;
          transition: transform .2s cubic-bezier(.2,.8,.2,1), opacity .18s ease;
          display: flex; flex-direction: column;
          background: var(--bg); border-radius: 12px; overflow: hidden;
          box-shadow: var(--panel-shadow);
        }
        .open .backdrop { opacity: 1; }
        .open .panel { opacity: 1; transform: translate(-50%, -50%) scale(1); }
        .bar { flex: none; border-bottom: 1px solid var(--line); }
        .url { flex: 1; }
        iframe { flex: 1; width: 100%; border: 0; background: #fff; }
      </style>
      <div class="wrap">
        <div class="backdrop"></div>
        <div class="panel" role="dialog" aria-label="Link preview">
          <div class="bar">${toolbarHTML({
            primary: { act: "tab", icon: ICON.main, label: "Open in tab", tip: "Open in a new tab" },
            secondary: { act: "mini", icon: ICON.mini, tip: "Open in mini window" },
            closeKey: "closePeek",
          })}</div>
          <iframe name="${PEEK_NAME}" allow="fullscreen; clipboard-write; autoplay; encrypted-media; picture-in-picture"></iframe>
        </div>
      </div>`;

    const wrap = root.querySelector(".wrap");
    const frame = root.querySelector("iframe");

    let current = url;
    const tb = bindToolbar(root, {
      getUrl: () => current,
      onAction: (act) => {
        if (act === "back") return browser.runtime.sendMessage({ type: "peekBack" });
        if (act === "close") return closePeek();
        browser.runtime.sendMessage({ type: act === "tab" ? "peekToTab" : "peekToMini", url: current });
        closePeek();
      },
    });
    const update = (u, canGoBack) => {
      tb.setUrl((current = u));
      tb.setCanGoBack(!!canGoBack);
    };
    update(url, false);

    // Lock page scrolling under the overlay.
    const prevOverflow = document.documentElement.style.overflow;
    document.documentElement.style.overflow = "hidden";

    root.querySelector(".backdrop").addEventListener("click", () => closePeek());

    frame.src = url;
    requestAnimationFrame(() => requestAnimationFrame(() => {
      wrap.classList.add("open");
      frame.focus();
    }));

    return {
      update,
      close(immediate) {
        document.documentElement.style.overflow = prevOverflow;
        if (immediate) return host.remove();
        wrap.classList.remove("open");
        setTimeout(() => host.remove(), 200);
      },
    };
  }
})();
