import { expect, test } from "bun:test";
import { bunEnv, bunExe, isWindows } from "harness";

// https://github.com/oven-sh/bun/issues/29102
//
// On Windows, `new Bun.WebView({})` (which defaults to backend: "chrome"
// off-Darwin) and `new Bun.WebView({ backend: { type: "chrome", path } })`
// both produced a misleading "Failed to spawn Chrome (set BUN_CHROME_PATH,
// backend.path, or install Chrome/Chromium)" ERR_DLOPEN_FAILED.
//
// The hint was false advice: ChromeProcess.zig's Bun__Chrome__ensure and
// spawn helper both short-circuit on Windows before BUN_CHROME_PATH /
// backend.path / findChrome are consulted. The chrome backend's
// socketpair + --remote-debugging-pipe fd plumbing has no direct Windows
// equivalent yet.
//
// Fix scope: the Windows guard is narrowed to the SPAWN path only.
// `backend: { url: "ws://..." }` and auto-detect-a-running-Chrome go
// through WebSocket (WebCore::WebSocket) and Bun__Chrome__autoDetect
// (which has a Windows branch reading DevToolsActivePort from
// %LOCALAPPDATA%), so those paths still work. Only when spawn is
// actually required do we throw ERR_METHOD_NOT_IMPLEMENTED with a
// clear platform-status message pointing users at the ws:// workaround.
const it = isWindows ? test : test.skip;

// Common assertions for the "Windows spawn not implemented" error.
// Checked on the error object directly; the spawned-child variant
// runs these against stdout.
const expectNotImplementedError = (err: any) => {
  expect(err).toBeDefined();
  expect(err.code).toBe("ERR_METHOD_NOT_IMPLEMENTED");
  expect(err.message).toMatch(/chrome.*spawn.*not.*yet.*implemented.*windows/i);
  // Old misleading hints — the ones the bug reporter followed.
  // BUN_CHROME_PATH / backend.path are inert on the Windows spawn
  // path, so the message must not suggest setting them.
  expect(err.message).not.toMatch(/BUN_CHROME_PATH/);
  expect(err.message).not.toMatch(/set.*backend\.path/);
  // The other failure modes have their own error codes — the spawn
  // rejection must not be confused with them.
  expect(err.code).not.toBe("ERR_DLOPEN_FAILED");
};

it("default (implicit chrome, no running browser) throws ERR_METHOD_NOT_IMPLEMENTED", () => {
  // Default backend off-Darwin is Chrome. With no running Chrome
  // reachable via DevToolsActivePort (CI Windows agents have no
  // pre-started browser), the constructor falls through to the spawn
  // path — which is what we're testing the Windows guard on.
  let err: any;
  let view: any;
  try {
    view = new (Bun as any).WebView({});
  } catch (e) {
    err = e;
  }
  // Fail-fast: if the constructor unexpectedly succeeds (e.g. a CI
  // runner has Chrome running with --remote-debugging-port), close
  // the view and fail with a distinct marker rather than leaving a
  // live view that could hang the suite.
  if (view) {
    try {
      view.close();
    } catch {}
    throw new Error("UNEXPECTED_SUCCESS: expected ERR_METHOD_NOT_IMPLEMENTED");
  }
  expectNotImplementedError(err);
});

it("explicit backend:'chrome' throws ERR_METHOD_NOT_IMPLEMENTED", () => {
  let err: any;
  let view: any;
  try {
    view = new (Bun as any).WebView({ backend: "chrome" });
  } catch (e) {
    err = e;
  }
  if (view) {
    try {
      view.close();
    } catch {}
    throw new Error("UNEXPECTED_SUCCESS: expected ERR_METHOD_NOT_IMPLEMENTED");
  }
  expectNotImplementedError(err);
});

it("backend.path override also throws ERR_METHOD_NOT_IMPLEMENTED", () => {
  // The user's original workaround in the bug report: setting an
  // explicit path. backend.path forces the spawn path, which is
  // inert on Windows — must throw the not-implemented error rather
  // than the misleading "failed to spawn" one.
  let err: any;
  let view: any;
  try {
    view = new (Bun as any).WebView({
      backend: {
        type: "chrome",
        path: "C:/Program Files/Google/Chrome/Application/chrome.exe",
      },
    });
  } catch (e) {
    err = e;
  }
  if (view) {
    try {
      view.close();
    } catch {}
    throw new Error("UNEXPECTED_SUCCESS: expected ERR_METHOD_NOT_IMPLEMENTED");
  }
  expectNotImplementedError(err);
});

it("backend.url:false forces spawn and throws ERR_METHOD_NOT_IMPLEMENTED", () => {
  // `url: false` is the documented knob to skip auto-detect and go
  // straight to spawn. It must hit the same Windows guard as the
  // other spawn-intended calls.
  let err: any;
  let view: any;
  try {
    view = new (Bun as any).WebView({
      backend: { type: "chrome", url: false },
    });
  } catch (e) {
    err = e;
  }
  if (view) {
    try {
      view.close();
    } catch {}
    throw new Error("UNEXPECTED_SUCCESS: expected ERR_METHOD_NOT_IMPLEMENTED");
  }
  expectNotImplementedError(err);
});

it("backend.url:'ws://...' is NOT blocked by the Windows guard", () => {
  // The WebSocket connect path (ensureConnected → WebCore::WebSocket)
  // does not touch ChromeProcess.zig's spawn helper, so it must NOT
  // throw ERR_METHOD_NOT_IMPLEMENTED on Windows. The guard was
  // previously too wide and blocked this scenario; make sure it
  // doesn't regress.
  //
  // The URL points at a port we know isn't listening, so the WebSocket
  // handshake will fail — but with ERR_DLOPEN_FAILED ("Failed to
  // connect to Chrome"), not ERR_METHOD_NOT_IMPLEMENTED. (The
  // constructor is synchronous; the WebSocket `create` either succeeds
  // in handing off to the native callback layer — in which case the
  // view is returned and the failure surfaces later — or returns a
  // sync error.) Either way we don't want the not-implemented branch.
  let err: any;
  let view: any;
  try {
    view = new (Bun as any).WebView({
      backend: { type: "chrome", url: "ws://127.0.0.1:1/devtools/browser/dead" },
    });
  } catch (e) {
    err = e;
  }
  if (view) {
    try {
      view.close();
    } catch {}
    // Sync construction succeeded — that's the happy case for this
    // test. The view's navigate() would reject asynchronously once
    // the WS handshake fails, but the point here is that construction
    // was NOT blocked by the Windows guard.
    return;
  }
  // If it threw, it must NOT be the not-implemented error.
  expect(err).toBeDefined();
  expect(err.code).not.toBe("ERR_METHOD_NOT_IMPLEMENTED");
  expect(err.message).not.toMatch(/chrome.*spawn.*not.*yet.*implemented.*windows/i);
});

it("BUN_CHROME_PATH env var does not change the spawn outcome", async () => {
  // Mirror of the bug report's second workaround. Spawn a child with
  // BUN_CHROME_PATH set and a backend that forces the spawn path,
  // and confirm the same ERR_METHOD_NOT_IMPLEMENTED surfaces — not
  // the old "Failed to spawn Chrome" ERR_DLOPEN_FAILED that told
  // users to set this env var.
  //
  // backend.url:false forces spawn deterministically — the default
  // {} could auto-detect-and-connect if Chrome happens to be running
  // on the test machine, making this test flaky by environment.
  //
  // If the constructor ever stops throwing, log UNEXPECTED_SUCCESS
  // and exit non-zero so the test fails fast instead of hanging on
  // a live view the child never closes.
  const script =
    "try {" +
    '  const v = new Bun.WebView({ backend: { type: "chrome", url: false } });' +
    "  v.close();" +
    '  console.log("UNEXPECTED_SUCCESS");' +
    "  process.exit(2);" +
    "} catch (e) {" +
    "  console.log(e.code);" +
    "  console.log(e.message);" +
    "}";
  await using proc = Bun.spawn({
    cmd: [bunExe(), "-e", script],
    env: {
      ...bunEnv,
      BUN_CHROME_PATH: "C:/Program Files/Google/Chrome/Application/chrome.exe",
    },
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  expect(stdout).not.toContain("UNEXPECTED_SUCCESS");
  expect(stdout).toContain("ERR_METHOD_NOT_IMPLEMENTED");
  expect(stdout).toMatch(/chrome.*spawn.*not.*yet.*implemented.*windows/i);
  expect(stdout).not.toContain("BUN_CHROME_PATH");
  expect(stdout).not.toContain("ERR_DLOPEN_FAILED");
  expect(stderr).toBe("");
  expect(exitCode).toBe(0);
});
