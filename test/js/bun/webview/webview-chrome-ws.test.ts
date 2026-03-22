// WebSocket-transport tests — connect to an already-running Chrome via CDP
// over ws://, instead of spawning our own with --remote-debugging-pipe.
//
// Separate file from webview-chrome.test.ts because Transport is a singleton:
// pipe-mode and connect-mode can't coexist in one process. The first
// constructor call locks the mode for the rest of the process lifetime.
//
// Enable these tests by turning on Remote Debugging in Chrome:
// chrome://inspect/#remote-debugging (the "Allow remote debugging" toggle).
// Chrome writes DevToolsActivePort to its profile dir; that file is the
// discovery source. The new toggle does NOT expose /json/version (404) —
// only the classic --remote-debugging-port flag does.
//
// INTERACTIVE: the new toggle pops "Allow remote debugging?" on every
// new WS connection. These tests run only when a dev is at the keyboard
// to click Allow. CI never hits this (no DevToolsActivePort → test.todo).

import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { homedir } from "node:os";

// Read DevToolsActivePort → ws:// URL. Mirrors the Zig readDevToolsActivePort
// path list so tests probe the same locations the runtime does.
function probeRemoteChrome(): { wsUrl: string; port: string } | undefined {
  const home = homedir();
  const local = process.env.LOCALAPPDATA;
  const paths =
    process.platform === "darwin"
      ? [
          `${home}/Library/Application Support/Google/Chrome/DevToolsActivePort`,
          `${home}/Library/Application Support/Google/Chrome Canary/DevToolsActivePort`,
          `${home}/Library/Application Support/Chromium/DevToolsActivePort`,
          `${home}/Library/Application Support/Microsoft Edge/DevToolsActivePort`,
        ]
      : process.platform === "linux"
        ? [
            `${home}/.config/google-chrome/DevToolsActivePort`,
            `${home}/.config/chromium/DevToolsActivePort`,
            `${home}/.config/microsoft-edge/DevToolsActivePort`,
          ]
        : process.platform === "win32" && local
          ? [
              `${local}\\Google\\Chrome\\User Data\\DevToolsActivePort`,
              `${local}\\Google\\Chrome SxS\\User Data\\DevToolsActivePort`,
              `${local}\\Chromium\\User Data\\DevToolsActivePort`,
              `${local}\\Microsoft\\Edge\\User Data\\DevToolsActivePort`,
            ]
          : [];
  for (const p of paths) {
    try {
      const [port, path] = readFileSync(p, "utf8").trim().split("\n");
      if (!port || !path) continue;
      return { wsUrl: `ws://127.0.0.1:${port.trim()}${path.trim()}`, port: port.trim() };
    } catch {
      // ENOENT — try next
    }
  }
  return undefined;
}

const remote = probeRemoteChrome();
const it = remote ? test : test.todo;

const html = (h: string) => "data:text/html," + encodeURIComponent(h);

it("connect via full ws:// URL", async () => {
  // Direct connect, no discovery. Commands queue in Transport's
  // m_wsPending until the handshake completes; navigate() resolves after.
  const view = new Bun.WebView({
    backend: { type: "chrome", url: remote!.wsUrl },
    width: 400,
    height: 300,
  });
  try {
    await view.navigate(html("<h1 id=t>ws-direct</h1>"));
    expect(await view.evaluate("document.getElementById('t').textContent")).toBe("ws-direct");
  } finally {
    view.close();
  }
});

it("connect via bare host:port (DevToolsActivePort discovery)", async () => {
  // "127.0.0.1:<port>" → Zig reads DevToolsActivePort (sync file read),
  // builds ws:// URL, calls onDiscovered synchronously. No HTTP GET —
  // the new toggle 404s /json/version anyway. Commands still queue
  // until the WS handshake completes (async).
  const view = new Bun.WebView({
    backend: { type: "chrome", url: `127.0.0.1:${remote!.port}` },
    width: 400,
    height: 300,
  });
  try {
    await view.navigate(html("<body>file-discovery</body>"));
    expect(await view.evaluate("document.body.textContent")).toBe("file-discovery");
  } finally {
    view.close();
  }
});

it("screenshot over WebSocket transport", async () => {
  // Same CDP Page.captureScreenshot; only the wire differs (WS text frames
  // instead of NUL-delimited pipe). The response handler's base64-decode →
  // Blob path is mode-agnostic.
  const view = new Bun.WebView({
    backend: { type: "chrome", url: remote!.wsUrl },
    width: 200,
    height: 150,
  });
  try {
    await view.navigate(html("<body style='background:red'></body>"));
    const blob = await view.screenshot();
    expect(blob).toBeInstanceOf(Blob);
    expect(blob.type).toBe("image/png");
    const bytes = new Uint8Array(await blob.arrayBuffer());
    expect(bytes[0]).toBe(0x89); // PNG magic
  } finally {
    view.close();
  }
});

it("cdp() over WebSocket transport", async () => {
  // Command::RawTag goes through the same finishToString() → sendTextNative
  // as every other command. Browser.getVersion is the simplest round-trip.
  const view = new Bun.WebView({
    backend: { type: "chrome", url: remote!.wsUrl },
    width: 100,
    height: 100,
  });
  try {
    await view.navigate(html("<body></body>"));
    const v = await view.cdp<{ product: string }>("Browser.getVersion");
    expect(v.product).toContain("Chrome");
  } finally {
    view.close();
  }
});
