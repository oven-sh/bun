import { expect, test } from "bun:test";
import { bunEnv, bunExe, isWindows, tempDir } from "harness";

// https://github.com/oven-sh/bun/issues/29102
const it = isWindows ? test : test.skip;

// Common assertions for the "Windows spawn not implemented" error.
// Checked on the error object directly; the spawned-child variant
// runs these against stdout.
const expectNotImplementedError = (err: any) => {
  expect(err).toBeDefined();
  expect(err.code).toBe("ERR_METHOD_NOT_IMPLEMENTED");
  expect(err.message).toMatch(/chrome.*spawn.*not.*yet.*implemented.*windows/i);
  // Positive: the message must point users at the ws:// connect
  // workaround — that's the actionable guidance the user needs and
  // the whole point of the fix (issue #29102). Without this check a
  // regression that strips the hint would silently pass.
  expect(err.message).toMatch(/ws:\/\//);
  // Old misleading hints — the ones the bug reporter followed.
  // BUN_CHROME_PATH / backend.path are inert on the Windows spawn
  // path, so the message must not suggest setting them.
  expect(err.message).not.toMatch(/BUN_CHROME_PATH/);
  expect(err.message).not.toMatch(/set.*backend\.path/);
  // The other failure modes have their own error codes — the spawn
  // rejection must not be confused with them.
  expect(err.code).not.toBe("ERR_DLOPEN_FAILED");
};

// Spawn a child with LOCALAPPDATA pointed at an empty temp dir so
// Bun__Chrome__autoDetect can't find a DevToolsActivePort file (it
// joins LOCALAPPDATA with Google\Chrome\User Data\... et al). That
// makes the default and `backend: "chrome"` cases deterministically
// fall through to the spawn path regardless of what's running on
// the host. BUN_CHROME_PATH is wiped too — the env-var override
// test below re-sets it explicitly.
async function runInScrubbedChild(script: string) {
  using dir = tempDir("bun-webview-win-29102-", {});
  await using proc = Bun.spawn({
    cmd: [bunExe(), "-e", script],
    env: {
      ...bunEnv,
      LOCALAPPDATA: String(dir),
      BUN_CHROME_PATH: "",
    },
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  return { stdout, stderr, exitCode };
}

// Child script that tries a given constructor arg, prints the
// resulting error code + message, or UNEXPECTED_SUCCESS + non-zero
// exit if it unexpectedly succeeds (so the parent sees a clean
// failure instead of hanging on a live view).
const childScript = (optsLiteral: string) =>
  "try {" +
  `  const v = new Bun.WebView(${optsLiteral});` +
  "  try { v.close(); } catch {}" +
  '  console.log("UNEXPECTED_SUCCESS");' +
  "  process.exit(2);" +
  "} catch (e) {" +
  "  console.log(e.code);" +
  "  console.log(e.message);" +
  "}";

// Matches the shape produced by expectNotImplementedError but on
// stdout from a spawned child. Keep the two in sync.
const expectChildStdoutNotImplemented = (stdout: string) => {
  expect(stdout).not.toContain("UNEXPECTED_SUCCESS");
  expect(stdout).toContain("ERR_METHOD_NOT_IMPLEMENTED");
  expect(stdout).toMatch(/chrome.*spawn.*not.*yet.*implemented.*windows/i);
  // Positive: mirror of the ws:// hint assertion in
  // expectNotImplementedError — see the comment there.
  expect(stdout).toMatch(/ws:\/\//);
  expect(stdout).not.toContain("BUN_CHROME_PATH");
  expect(stdout).not.toMatch(/set.*backend\.path/);
  expect(stdout).not.toContain("ERR_DLOPEN_FAILED");
};

it("default (implicit chrome) throws ERR_METHOD_NOT_IMPLEMENTED when no running Chrome", async () => {
  // The exact shape from the bug report. Run in a scrubbed child so
  // auto-detect is guaranteed to miss regardless of what's running on
  // the host.
  const { stdout, exitCode } = await runInScrubbedChild(childScript("{}"));
  expectChildStdoutNotImplemented(stdout);
  // stderr intentionally NOT asserted — ASAN-enabled builds emit a
  // "WARNING: ASAN interferes with JSC signal handlers" line there
  // even on successful runs, which would make this test brittle.
  expect(exitCode).toBe(0);
});

it("explicit backend:'chrome' throws ERR_METHOD_NOT_IMPLEMENTED when no running Chrome", async () => {
  const { stdout, exitCode } = await runInScrubbedChild(childScript('{ backend: "chrome" }'));
  expectChildStdoutNotImplemented(stdout);
  expect(exitCode).toBe(0);
});

it("backend.path override throws ERR_METHOD_NOT_IMPLEMENTED", () => {
  // The user's original workaround in the bug report. backend.path
  // forces the spawn path unconditionally (no auto-detect), so this
  // is deterministic even without scrubbing the environment — safe
  // to run in-process.
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
  // straight to spawn. Deterministic in-process — no auto-detect,
  // no environment dependency.
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
  // handshake will fail — but that surfaces as a CDP error later, not
  // as a constructor-level ERR_METHOD_NOT_IMPLEMENTED. Either the
  // constructor returns a view (WS handshake still pending) or it
  // throws a ConnectFailed — neither is the spawn guard.
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
    // test. The point is that construction was NOT blocked by the
    // Windows guard.
    return;
  }
  // If it threw, it must NOT be the not-implemented error.
  expect(err).toBeDefined();
  expect(err.code).not.toBe("ERR_METHOD_NOT_IMPLEMENTED");
  expect(err.message).not.toMatch(/chrome.*spawn.*not.*yet.*implemented.*windows/i);
});

it("BUN_CHROME_PATH env var does not change the spawn outcome", async () => {
  // Mirror of the bug report's second workaround: setting
  // BUN_CHROME_PATH and hoping it dodges the error. The env var is
  // inert on the Windows spawn path (ChromeProcess.zig's short-circuit
  // beats findChrome to the decision), so the same
  // ERR_METHOD_NOT_IMPLEMENTED must surface — not the old "Failed to
  // spawn Chrome" ERR_DLOPEN_FAILED that told users to set this env
  // var.
  //
  // Forces spawn via `backend.url: false`, in a scrubbed child so
  // auto-detect can't accidentally find a running Chrome.
  using dir = tempDir("bun-webview-win-29102-env-", {});
  await using proc = Bun.spawn({
    cmd: [bunExe(), "-e", childScript('{ backend: { type: "chrome", url: false } }')],
    env: {
      ...bunEnv,
      LOCALAPPDATA: String(dir),
      BUN_CHROME_PATH: "C:/Program Files/Google/Chrome/Application/chrome.exe",
    },
    stdout: "pipe",
    stderr: "pipe",
  });
  // Drain stderr even though we don't assert on it — leaving a
  // piped stderr unread can deadlock the child when its buffer
  // fills (ASAN's JSC signal-handler warning fits easily, but
  // the pattern is the gotcha). Discard the value.
  const [stdout, , exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  expectChildStdoutNotImplemented(stdout);
  expect(exitCode).toBe(0);
});
