// Minifox — a mini window and link peek for Firefox.
//
// 1. Mini window: Finicky appends a #minifox_open_in_mini marker to links opened from other
//    apps. We catch that navigation before the page loads and reopen the URL
//    in a compact popup window.
// 2. Peek: Shift+click on a link opens a preview overlay (see content.js).
//    So that sites which forbid embedding still load, X-Frame-Options and
//    CSP frame-ancestors are stripped for the peek frame — and only for it.
// 3. Tabs opened by a plain click are brought to the front (see below).
//
// Everything opened from a tab (mini window, "Open in tab", "Open in Firefox")
// keeps that tab's container (cookieStoreId) and private-browsing state.

const MARK = "#minifox_open_in_mini";
const MAIN_MARK = "#minifox_open_in_main";

// How long after a plain click a new tab from that page still counts as
// "opened by the click" and gets brought to the front.
const CLICK_WINDOW_MS = 1500;

// Mini window size, position ("center" or "top-right") and screen margin.
const SIZE = { width: 1000, height: 760 };
const POSITION = "center";
const MARGIN = 24;

const handled = new Set(); // guards against duplicate events for one tab

// tabId -> { url (no #fragment), frameId | null, current, stack }
const peeks = new Map();

// Popup windows opened by openMini. Other popups (OAuth sign-in, payment
// windows opened by sites) are left alone: no toolbar, no "open full".
const miniWindows = new Set();
browser.windows.onRemoved.addListener((id) => miniWindows.delete(id));

const stripHash = (u) => u.split("#")[0];

// ---------- Opening things in the right context ----------

// Container / private-browsing context of a tab.
const ctxOf = (tab) => ({ cookieStoreId: tab.cookieStoreId, incognito: !!tab.incognito });

// tabs.create / windows.create options that put a new tab in `ctx`'s container.
function containerOpts(ctx) {
  if (!ctx || ctx.incognito) return {};
  const id = ctx.cookieStoreId;
  return id && id !== "firefox-default" ? { cookieStoreId: id } : {};
}

function popupGeometry() {
  // `screen` is available in MV2 background pages.
  const s = window.screen;
  const width = Math.min(SIZE.width, s.availWidth - MARGIN * 2);
  const height = Math.min(SIZE.height, s.availHeight - MARGIN * 2);
  const x0 = s.availLeft || 0;
  const y0 = s.availTop || 0;

  if (POSITION === "top-right") {
    return { width, height, left: x0 + s.availWidth - width - MARGIN, top: y0 + MARGIN };
  }
  return {
    width,
    height,
    left: Math.round(x0 + (s.availWidth - width) / 2),
    top: Math.round(y0 + (s.availHeight - height) / 2),
  };
}

async function openMini(url, ctx = null) {
  const opts = { type: "popup", url, focused: true, ...popupGeometry() };
  if (ctx?.incognito) opts.incognito = true;

  let win;
  try {
    win = await browser.windows.create({ ...opts, ...containerOpts(ctx) });
  } catch (e) {
    // e.g. the container was removed meanwhile — open without it.
    console.warn("minifox: opening without container", e);
    win = await browser.windows.create(opts);
  }
  miniWindows.add(win.id);
  // Firefox may be in the background (Finicky opens links with `open -g`):
  // explicitly bring only the mini window forward.
  await browser.windows.update(win.id, { focused: true });
  return win;
}

// Open `url` in the main window (matching private state), in `ctx`'s
// container, then optionally close `closeWindowId`.
async function openInMain(url, ctx = null, closeWindowId = null) {
  const incognito = !!ctx?.incognito;
  const normals = await browser.windows.getAll({ windowTypes: ["normal"] });
  const pool = normals.filter((w) => !!w.incognito === incognito);
  const main = pool.find((w) => w.focused) || pool[0];

  if (main) {
    await browser.tabs.create({ windowId: main.id, url, active: true, ...containerOpts(ctx) });
    await browser.windows.update(main.id, { focused: true });
  } else {
    await browser.windows.create({ url, incognito, ...containerOpts(ctx) });
  }
  if (closeWindowId != null) await browser.windows.remove(closeWindowId);
}

// ---------- 1. Mini window for external links ----------

// External links that should open in the main window (Finicky exceptions)
// carry #minifox_open_in_main. Firefox opens them as a background tab
// (browser.tabs.loadDivertedInBackground = true), so we load the clean URL
// and bring the tab and its window forward ourselves.
browser.webNavigation.onBeforeNavigate.addListener(async ({ tabId, frameId, url }) => {
  if (frameId !== 0 || !url.endsWith(MAIN_MARK) || handled.has(tabId)) return;
  handled.add(tabId);
  try {
    const tab = await browser.tabs.update(tabId, {
      url: url.slice(0, -MAIN_MARK.length),
      active: true,
    });
    await browser.windows.update(tab.windowId, { focused: true });
  } catch (e) {
    console.error("minifox:", e);
  } finally {
    setTimeout(() => handled.delete(tabId), 5000);
  }
});

browser.webNavigation.onBeforeNavigate.addListener(async ({ tabId, frameId, url }) => {
  if (frameId !== 0 || !url.endsWith(MARK) || handled.has(tabId)) return;
  handled.add(tabId);

  const clean = url.slice(0, -MARK.length);

  try {
    const tab = await browser.tabs.get(tabId);
    await openMini(clean, ctxOf(tab));

    // If the link landed in its own single-tab window, close the window;
    // otherwise close just the tab.
    const siblings = await browser.tabs.query({ windowId: tab.windowId });
    if (siblings.length === 1) {
      await browser.windows.remove(tab.windowId);
    } else {
      await browser.tabs.remove(tabId);
    }
  } catch (e) {
    console.error("minifox:", e);
  } finally {
    setTimeout(() => handled.delete(tabId), 5000);
  }
});

// ---------- "Open full": one shortcut for the mini window and the peek ----------
//
// ⌘⇧O (Ctrl+Shift+O elsewhere): with a peek open, open the peeked page in a
// tab; in a mini window, move the page to the main window. The command and
// the content-script fallback may both fire for one key press — dedupe.

const recentFull = new Map(); // tabId -> timestamp

async function peekToTab(tab, fallbackUrl) {
  const url = peeks.get(tab.id)?.current || fallbackUrl;
  peeks.delete(tab.id);
  if (!url) return;
  const w = await browser.windows.get(tab.windowId);
  if (w.type === "popup") {
    // From a mini window, open the tab in the main window.
    return openInMain(url, ctxOf(tab));
  }
  return browser.tabs.create({
    url, windowId: tab.windowId, index: tab.index + 1, active: true, ...containerOpts(ctxOf(tab)),
  });
}

async function openFull(tab) {
  const now = Date.now();
  if (now - (recentFull.get(tab.id) || 0) < 600) return;
  recentFull.set(tab.id, now);

  if (peeks.has(tab.id)) {
    await peekToTab(tab);
    browser.tabs.sendMessage(tab.id, { type: "closePeek" }, { frameId: 0 }).catch(() => {});
    return;
  }
  if (miniWindows.has(tab.windowId)) await openInMain(tab.url, ctxOf(tab), tab.windowId);
}

browser.commands.onCommand.addListener(async (cmd, tab) => {
  if (cmd !== "open-in-main") return;
  tab ??= (await browser.tabs.query({ active: true, lastFocusedWindow: true }))[0];
  if (tab) openFull(tab);
});

// Address bar icon in the mini window.
browser.pageAction.onClicked.addListener((tab) => openInMain(tab.url, ctxOf(tab), tab.windowId));

// ---------- Shortcut labels for the UI ----------
//
// Shown in toolbar buttons and tooltips: "⌘⇧O" on macOS, "Ctrl+Shift+O"
// elsewhere. The open-full label comes from the actual binding, so it follows
// the user's changes in Manage Extension Shortcuts.

function formatShortcut(s, mac) {
  if (!s) return "";
  const parts = s.split("+");
  const key = parts.pop();
  const keyLabel = {
    Comma: ",", Period: ".", Space: "Space",
    Up: "↑", Down: "↓", Left: "←", Right: "→",
  }[key] || key;

  if (!mac) {
    const mods = parts.map((p) => (p === "Command" || p === "MacCtrl" ? "Ctrl" : p));
    return [...mods, keyLabel].join("+");
  }
  const order = ["MacCtrl", "Alt", "Shift", "Command", "Ctrl"];
  const sym = { MacCtrl: "⌃", Alt: "⌥", Shift: "⇧", Command: "⌘", Ctrl: "⌘" };
  return parts
    .sort((a, b) => order.indexOf(a) - order.indexOf(b))
    .map((p) => sym[p] || p)
    .join("") + keyLabel;
}

async function shortcutLabels() {
  const { os } = await browser.runtime.getPlatformInfo();
  const mac = os === "mac";
  const cmds = await browser.commands.getAll();
  const open = cmds.find((c) => c.name === "open-in-main")?.shortcut || "";
  return {
    openFull: formatShortcut(open, mac),
    copy: formatShortcut(mac ? "Command+Shift+C" : "Ctrl+Shift+C", mac),
    closeWindow: formatShortcut(mac ? "Command+W" : "Ctrl+W", mac),
    closePeek: "Esc",
  };
}

// ---------- 2. Peek: allow the preview frame to load ----------

function stripFrameHeaders(headers) {
  const out = [];
  for (const h of headers) {
    const name = h.name.toLowerCase();
    if (name === "x-frame-options") continue;
    if (name === "content-security-policy" && h.value) {
      const value = h.value
        .split(";")
        .filter((d) => !/^\s*frame-ancestors\b/i.test(d))
        .join(";");
      if (value.trim()) out.push({ name: h.name, value });
      continue;
    }
    out.push(h);
  }
  return out;
}

browser.webRequest.onHeadersReceived.addListener(
  (d) => {
    const peek = peeks.get(d.tabId);
    if (!peek || d.parentFrameId !== 0) return;

    if (peek.frameId == null) {
      // First request of the peek frame: remember its frameId and match
      // later requests (redirects, navigation inside the peek) by it.
      if (stripHash(d.url) !== peek.url) return;
      peek.frameId = d.frameId;
    } else if (d.frameId !== peek.frameId) {
      return;
    }
    return { responseHeaders: stripFrameHeaders(d.responseHeaders) };
  },
  { urls: ["<all_urls>"], types: ["sub_frame"] },
  ["blocking", "responseHeaders"]
);

// Track where the peek navigated, so the toolbar shows the current URL,
// "Open in tab" opens the current page, and "Back" knows if there's history.
// `stack` is the peek's own history: going back to the previous entry pops it.
function peekNavigated({ tabId, frameId, url }) {
  const peek = peeks.get(tabId);
  if (!peek || frameId === 0 || frameId !== peek.frameId) return;

  const s = peek.stack;
  if (s.length > 1 && s[s.length - 2] === url) s.pop();
  else if (s[s.length - 1] !== url) s.push(url);

  peek.current = url;
  browser.tabs.sendMessage(
    tabId,
    { type: "peekNavigated", url, canGoBack: s.length > 1 },
    { frameId: 0 }
  ).catch(() => {});
}
browser.webNavigation.onCommitted.addListener(peekNavigated);
browser.webNavigation.onHistoryStateUpdated.addListener(peekNavigated); // SPA navigation

// The page under the peek navigated away (or reloaded): the overlay is gone,
// so forget the peek — otherwise "open full" would later open its stale URL.
browser.webNavigation.onCommitted.addListener(({ tabId, frameId }) => {
  if (frameId === 0) peeks.delete(tabId);
});

browser.tabs.onRemoved.addListener((tabId) => {
  peeks.delete(tabId);
  recentFull.delete(tabId);
});

// ---------- 3. Foreground tabs opened by plain clicks ----------
//
// With browser.tabs.loadDivertedInBackground = true (needed so external links
// don't raise the main window), Firefox also opens target="_blank" links from
// pages in the background. Restore the default: a tab opened by a plain click
// (no modifiers, primary button) becomes active. ⌘-click and middle-click
// still open in the background.

const lastClick = new Map(); // tabId -> { plain, t }

function maybeActivate(tab, retry = true) {
  const c = lastClick.get(tab.openerTabId);
  if (c && c.plain && Date.now() - c.t < CLICK_WINDOW_MS) {
    lastClick.delete(tab.openerTabId);
    browser.tabs.update(tab.id, { active: true }).catch(() => {});
  } else if (retry) {
    // The click message may arrive slightly after the tab is created.
    setTimeout(() => maybeActivate(tab, false), 150);
  }
}

browser.tabs.onCreated.addListener((tab) => {
  if (tab.active || tab.openerTabId == null) return;
  maybeActivate(tab);
});

browser.tabs.onRemoved.addListener((tabId) => lastClick.delete(tabId));

// ---------- Messages from content.js ----------

browser.runtime.onMessage.addListener((msg, sender) => {
  const tab = sender.tab;
  if (!tab) return;

  switch (msg.type) {
    case "keys":
      return shortcutLabels();

    case "tabUrl":
      return Promise.resolve(tab.url);

    case "toast": // from a subframe: show it in the top frame
      return browser.tabs.sendMessage(tab.id, { type: "toast", text: msg.text }, { frameId: 0 });

    case "userClick":
      lastClick.set(tab.id, { plain: msg.plain, t: Date.now() });
      return;

    case "isMini": {
      const mini = miniWindows.has(tab.windowId);
      if (mini) browser.pageAction.show(tab.id).catch(() => {});
      return Promise.resolve(mini);
    }

    case "openFull": // shortcut fallback from the page or the peek frame
      return openFull(tab);

    case "openInMain":
      return openInMain(tab.url, ctxOf(tab), tab.windowId);

    case "closeMini":
      return browser.windows.remove(tab.windowId);

    case "peekOpen":
      peeks.set(tab.id, { url: stripHash(msg.url), frameId: null, current: msg.url, stack: [] });
      return Promise.resolve(true);

    case "peekClosed":
      peeks.delete(tab.id);
      return;

    case "peekBack": { // go back inside the peek frame only, never the page under it
      const peek = peeks.get(tab.id);
      if (!peek || peek.frameId == null || peek.stack.length < 2) return;
      return browser.tabs.sendMessage(tab.id, { type: "peekGoBack" }, { frameId: peek.frameId });
    }

    case "peekEscape": // Esc pressed inside the peek frame
      return browser.tabs.sendMessage(tab.id, { type: "closePeek" }, { frameId: 0 });

    case "peekToTab":
      return peekToTab(tab, msg.url);

    case "peekToMini": {
      const url = peeks.get(tab.id)?.current || msg.url;
      peeks.delete(tab.id);
      return openMini(url, ctxOf(tab));
    }
  }
});
