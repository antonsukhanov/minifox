// ~/.finicky.js — Finicky v4
// Every external http(s) link goes to Firefox with a marker appended:
//   #minifox_open_in_mini — the Minifox extension opens it in a mini window;
//   #minifox_open_in_main — the extension opens it as a focused tab in the main window
//             (apps/hosts from the exception lists below).

const MINI = "#minifox_open_in_mini";
const MAIN = "#minifox_open_in_main";

// Hosts that should always open in the main window (add your own).
const FULL_WINDOW_HOSTS = [
  // "youtube.com", "*.youtube.com",
];

// Apps whose links should always open in the main window (bundle IDs).
const SKIP_OPENERS = [
  // "com.microsoft.VSCode",
];

const isMarked = (href) => href.endsWith(MINI) || href.endsWith(MAIN);

function wantsMainWindow(url, opener) {
  if (opener && SKIP_OPENERS.includes(opener.bundleId)) return true;
  const host = url.hostname;
  return FULL_WINDOW_HOSTS.some((h) =>
    h.startsWith("*.") ? host.endsWith(h.slice(1)) : host === h
  );
}

export default {
  defaultBrowser: "Firefox",
  options: {
    keepRunning: true,
    hideIcon: true,
  },
  rewrite: [
    {
      match: (url) => /^https?:$/.test(url.protocol) && !isMarked(url.href),
      url: (url, { opener }) =>
        url.href + (wantsMainWindow(url, opener) ? MAIN : MINI),
    },
  ],
  handlers: [
    {
      // Hand marked links to Firefox without activating it. The extension then
      // brings forward exactly the right window: the mini window, or the main
      // window for #minifox_open_in_main links.
      match: (url) => isMarked(url.href),
      browser: { name: "Firefox", openInBackground: true },
    },
  ],
};
