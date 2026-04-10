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
// equivalent yet — it needs named pipes or libuv.
//
// The constructor now throws ERR_METHOD_NOT_IMPLEMENTED with a clear
// platform-status message on Windows, mirroring the pattern already used
// for backend:"webkit" on non-Darwin.
const it = isWindows ? test : test.skip;

it("default (implicit chrome) throws ERR_METHOD_NOT_IMPLEMENTED", () => {
  let err: any;
  try {
    new (Bun as any).WebView({});
  } catch (e) {
    err = e;
  }
  expect(err).toBeDefined();
  expect(err.code).toBe("ERR_METHOD_NOT_IMPLEMENTED");
  expect(err.message).toMatch(/chrome.*not.*yet.*implemented.*windows/i);
  // The old error pointed at BUN_CHROME_PATH / backend.path — those
  // knobs have no effect on Windows, so the message must not hint at
  // them (the user followed that advice and nothing changed).
  expect(err.message).not.toMatch(/BUN_CHROME_PATH/);
  expect(err.message).not.toMatch(/backend\.path/);
});

it("explicit backend:'chrome' throws ERR_METHOD_NOT_IMPLEMENTED", () => {
  let err: any;
  try {
    new (Bun as any).WebView({ backend: "chrome" });
  } catch (e) {
    err = e;
  }
  expect(err).toBeDefined();
  expect(err.code).toBe("ERR_METHOD_NOT_IMPLEMENTED");
  expect(err.message).toMatch(/chrome.*not.*yet.*implemented.*windows/i);
});

it("backend.path override also throws ERR_METHOD_NOT_IMPLEMENTED", () => {
  // The user's original workaround in the bug report: setting an
  // explicit path. Must still throw the not-implemented error, not
  // the "failed to spawn" error — the path option is inert on
  // Windows and the message must make that clear.
  let err: any;
  try {
    new (Bun as any).WebView({
      backend: {
        type: "chrome",
        path: "C:/Program Files/Google/Chrome/Application/chrome.exe",
      },
    });
  } catch (e) {
    err = e;
  }
  expect(err).toBeDefined();
  expect(err.code).toBe("ERR_METHOD_NOT_IMPLEMENTED");
  expect(err.message).toMatch(/chrome.*not.*yet.*implemented.*windows/i);
  expect(err.code).not.toBe("ERR_DLOPEN_FAILED");
});

it("BUN_CHROME_PATH env var does not change the outcome", async () => {
  // Mirror of the bug report's second workaround. Spawn a child
  // with BUN_CHROME_PATH set and confirm the same
  // ERR_METHOD_NOT_IMPLEMENTED surfaces — not the old "Failed to
  // spawn Chrome" ERR_DLOPEN_FAILED that told users to set this
  // env var.
  await using proc = Bun.spawn({
    cmd: [bunExe(), "-e", "try { new Bun.WebView({}); } catch (e) { console.log(e.code); console.log(e.message); }"],
    env: {
      ...bunEnv,
      BUN_CHROME_PATH: "C:/Program Files/Google/Chrome/Application/chrome.exe",
    },
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  expect(stdout).toContain("ERR_METHOD_NOT_IMPLEMENTED");
  expect(stdout).toMatch(/chrome.*not.*yet.*implemented.*windows/i);
  expect(stdout).not.toContain("BUN_CHROME_PATH");
  expect(stdout).not.toContain("ERR_DLOPEN_FAILED");
  expect(exitCode).toBe(0);
});
