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
import { bunEnv, bunExe } from "harness";
import { readFileSync } from "node:fs";
import { homedir } from "node:os";

// Read DevToolsActivePort → ws:// URL, then verify the WS actually
// accepts (the file can be stale, or the new chrome://inspect toggle
// pops an Allow dialog that the user isn't clicking). Without the
// verify step, tests time out on the dialog, leaving the Transport
// singleton stuck and poisoning the other test files in this directory
// (bun test <dir> runs all files in one process).
function findDevToolsActivePort(): { wsUrl: string; port: string } | undefined {
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

// Actually connect and send Browser.getVersion. If the user clicks
// Allow within 2s, we get a response → tests enabled. If not (nobody
// at the keyboard, stale file, dialog dismissed), test.todo — the
// singleton stays clean and webview-chrome.test.ts runs unaffected.
async function probeRemoteChrome(): Promise<{ wsUrl: string; port: string } | undefined> {
  const port = findDevToolsActivePort();
  if (!port) return undefined;
  return new Promise(resolve => {
    const ws = new WebSocket(port.wsUrl);
    const bail = () => {
      ws.close();
      resolve(undefined);
    };
    const timer = setTimeout(bail, 2000);
    ws.onopen = () => ws.send('{"id":1,"method":"Browser.getVersion"}');
    ws.onmessage = () => {
      clearTimeout(timer);
      ws.close();
      resolve(port);
    };
    ws.onerror = bail;
    ws.onclose = () => clearTimeout(timer);
  });
}

const remote = await probeRemoteChrome();
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

it("auto-detect: backend:'chrome' without url/path reads DevToolsActivePort", async () => {
  // No url, no path, no argv → Zig reads DevToolsActivePort (sync file
  // read), builds ws:// URL, ensureConnected with autoDetected=true.
  // Commands queue until the WS handshake completes. If the file were
  // stale (dead Chrome), wsOnClose would fall back to spawn — but
  // since probeRemoteChrome found the same file, we know Chrome IS up.
  const view = new Bun.WebView({
    backend: "chrome",
    width: 400,
    height: 300,
  });
  try {
    await view.navigate(html("<body>auto-detect</body>"));
    expect(await view.evaluate("document.body.textContent")).toBe("auto-detect");
  } finally {
    view.close();
  }
});

it("url:false skips auto-detect even when DevToolsActivePort exists", async () => {
  // Subprocess-isolated — spawning would lock this process's singleton
  // into Pipe mode (pipe doesn't idle-close; the subprocess is ours),
  // breaking subsequent WS tests. Explicit opt-out — spawn headless
  // Chrome despite the file. This is the automation-friendly path (no
  // dialog, no visible tabs).
  await using proc = Bun.spawn({
    cmd: [
      bunExe(),
      "-e",
      `
        const view = new Bun.WebView({ backend: {type:"chrome", url:false}, width: 200, height: 200 });
        await view.navigate("data:text/html,<body>spawned</body>");
        const t = await view.evaluate("document.body.textContent");
        if (t !== "spawned") throw new Error("got: " + t);
        view.close();
        console.log("ok");
      `,
    ],
    env: bunEnv,
  });
  const [stdout, exitCode] = await Promise.all([proc.stdout.text(), proc.exited]);
  expect(stdout.trim()).toBe("ok");
  expect(exitCode).toBe(0);
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
