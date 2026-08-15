import { afterAll, beforeAll, expect, test } from "bun:test";
import { bunEnv, bunExe, isCI, isMacOS, isMacOSVersionAtLeast, tempDir } from "harness";

// Chrome backend works on any platform with Chrome/Chromium installed.
// Mark tests todo if no Chrome found (CI may not have it). Mirrors
// ChromeProcess.zig's findChrome() — $PATH names, then hardcoded absolute
// paths, then Playwright cache — so the test detects Chrome whenever the
// runtime would.
import { dlopen, FFIType, ptr } from "bun:ffi";
import {
  accessSync,
  chmodSync,
  existsSync,
  constants as fsConstants,
  readdirSync,
  readFileSync,
  rmSync,
} from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

// shm_unlink for encoding:"shmem" test cleanup. macOS has no /dev/shm
// filesystem mount, so we go through libc. Linux exposes POSIX shm at
// /dev/shm/<name-without-leading-slash> — a plain unlink works.
const libcShm =
  process.platform === "darwin"
    ? dlopen("libc.dylib", {
        shm_unlink: { args: [FFIType.cstring], returns: FFIType.i32 },
      })
    : null;
function shmUnlinkChrome(name: string): void {
  if (process.platform === "darwin") {
    libcShm!.symbols.shm_unlink(ptr(Buffer.from(name + "\0")));
  } else if (process.platform === "linux") {
    rmSync("/dev/shm" + name, { force: true });
  }
}

function findChrome(): string | undefined {
  const isExecutable = (p: string) => {
    try {
      accessSync(p, fsConstants.X_OK);
      return true;
    } catch {
      return false;
    }
  };

  if (process.env.BUN_CHROME_PATH) {
    return isExecutable(process.env.BUN_CHROME_PATH) ? process.env.BUN_CHROME_PATH : undefined;
  }

  // $PATH — same as `which google-chrome` etc.
  const names = ["google-chrome-stable", "google-chrome", "chromium-browser", "chromium", "microsoft-edge", "chrome"];
  for (const n of names) {
    const found = Bun.which(n);
    if (found) return found;
  }

  // Hardcoded absolute paths — app bundles aren't in $PATH on macOS.
  if (process.platform === "darwin") {
    const bundles = [
      "Google Chrome.app/Contents/MacOS/Google Chrome",
      "Google Chrome Canary.app/Contents/MacOS/Google Chrome Canary",
      "Chromium.app/Contents/MacOS/Chromium",
      "Microsoft Edge.app/Contents/MacOS/Microsoft Edge",
    ];
    for (const b of bundles) {
      const sys = join("/Applications", b);
      if (isExecutable(sys)) return sys;
      const user = join(homedir(), "Applications", b);
      if (isExecutable(user)) return user;
    }
  } else if (process.platform === "linux") {
    const absolute = [
      "/usr/bin/google-chrome-stable",
      "/usr/bin/google-chrome",
      "/usr/bin/chromium-browser",
      "/usr/bin/chromium",
      "/snap/bin/chromium",
      "/usr/bin/microsoft-edge",
    ];
    for (const c of absolute) if (isExecutable(c)) return c;
  } // Windows TODO — ChromeProcess.zig doesn't support it yet

  // Playwright cache fallback — mirrors findPlaywrightShell().
  const cacheDir =
    process.platform === "darwin"
      ? join(homedir(), "Library/Caches/ms-playwright")
      : join(homedir(), ".cache/ms-playwright");
  let bestRev = 0;
  let bestName = "";
  try {
    for (const name of readdirSync(cacheDir)) {
      const m = name.match(/^chromium_headless_shell-(\d+)$/);
      if (m && +m[1] > bestRev) {
        bestRev = +m[1];
        bestName = name;
      }
    }
  } catch {}
  if (!bestRev) return undefined;
  const arch = process.arch === "arm64" ? "arm64" : "x64";
  const plat = process.platform === "darwin" ? "mac" : "linux";
  const bin = join(cacheDir, bestName, `chrome-headless-shell-${plat}-${arch}`, "chrome-headless-shell");
  if (isExecutable(bin)) return bin;
  if (process.platform === "linux" && process.arch === "arm64") {
    const bin2 = join(cacheDir, bestName, "chrome-linux/headless_shell");
    if (isExecutable(bin2)) return bin2;
  }
  return undefined;
}

const chromePath = findChrome();
// TODO: macOS 13/14 aarch64 CI — findChrome() resolves the Playwright
// chrome-headless-shell, but it either throws ERR_DLOPEN_FAILED at spawn or
// launches and immediately closes the pipe on first navigate. Recent Chromium
// builds link against frameworks only present on macOS 15+, so the binary
// exists but can't run. Gate on CI + macOS < 15 rather than probing — a real
// probe needs an async navigate, which adds startup cost on every platform.
const chromeBroken = isCI && isMacOS && !isMacOSVersionAtLeast(15);
const chromeAvailable = !!chromePath && !chromeBroken;

// url:false forces spawn-mode — skips DevToolsActivePort auto-detect
// which would connect to the dev's running Chrome, pop the "Allow remote
// debugging?" dialog on every test, and create visible tabs. The
// executable path is still auto-found.
//
// WebSocket-transport tests live in webview-chrome-ws.test.ts — the
// Transport singleton means you can't mix pipe-mode (this file) and
// connect-mode in one process.
const chrome = { type: "chrome" as const, url: false as const };

const html = (h: string) => "data:text/html," + encodeURIComponent(h);

// --- Scheduling ------------------------------------------------------------------
//
// One Chrome serves the whole process; each `new Bun.WebView()` that gets
// navigated is a tab of it. What this file's wall clock is made of (Linux,
// release build): a fresh tab (Target.createTarget, i.e. a renderer process,
// then attach + first navigate) is ~100ms on an idle 12-core box and ~165ms
// on 4 vCPUs, and Chrome creates tabs one at a time, so opening them
// concurrently does not help; navigating an existing tab to another data:
// URL is ~20-30ms; an evaluate()/click() is ~2ms; launching a bun child with
// a Chrome of its own is ~0.4s and ~145 threads. Hence three kinds of test:
//
//   itOnPage  — borrows one of POOL_SIZE long-lived tabs, navigated to the
//               test's HTML. For everything that only needs a page to act
//               on. The tab is handed back afterwards, so the test must not
//               close, resize or otherwise reconfigure it (navigating is fine).
//   it        — opens its own tab(s): anything about a view's lifecycle,
//               history, constructor options or per-view configuration. At
//               most 4 such tests at a time, so that a burst of tabs can't
//               exhaust a small container's /dev/shm or pid limit (bun's own
//               --max-concurrency default is 20).
//   itInChild — asserts on the ONE child bun process, with a Chrome of its
//               own, that the tests sharing it launch on first use: anything
//               the first spawn in a process decides, anything visible only
//               on the process's stdio, and killing Chrome.
//
// All of them run concurrently (a test's clock includes any time spent
// waiting for a tab); each alias is test.todo when Chrome is unavailable.

function lanes(width: number): <T>(fn: () => Promise<T>) => Promise<T> {
  let busy = 0;
  const waiting: (() => void)[] = [];
  return async fn => {
    if (busy < width) busy++;
    else await new Promise<void>(resolve => waiting.push(resolve));
    try {
      return await fn();
    } finally {
      // Hand the lane straight to the next waiter (busy stays counted), or free it.
      const next = waiting.shift();
      if (next) next();
      else busy--;
    }
  };
}

// A third pooled tab measured no faster than two: tab work still funnels
// through Chrome's browser process.
const POOL_SIZE = 2;
// Constructor size of the pooled tabs, and what their viewport is pinned to:
// the size the input/scroll tests below are written against.
const PAGE_SIZE = 300;
const idlePages: Bun.WebView[] = [];
const pageLane = lanes(POOL_SIZE);
const tabLane = lanes(4);

type TestBody = () => void | Promise<void>;

async function newPooledPage(): Promise<Bun.WebView> {
  const page = new Bun.WebView({ backend: chrome, width: PAGE_SIZE, height: PAGE_SIZE });
  await page.navigate("about:blank");
  // Target.createTarget's width/height size the window; with a full Chrome
  // (as opposed to chrome-headless-shell) the viewport comes out shorter by
  // the browser UI it models. Emulating the size makes the viewport exactly
  // PAGE_SIZE square on every Chrome flavour.
  await page.resize(PAGE_SIZE, PAGE_SIZE);
  return page;
}

type PageBody = (page: Bun.WebView, url: string) => void | Promise<void>;
async function onPooledPage(pageHtml: string, fn: PageBody): Promise<void> {
  // pageLane admits at most POOL_SIZE borrowers, so the pool only runs short
  // when an earlier borrower's tab was retired below.
  const page = idlePages.pop() ?? (await newPooledPage());
  let passed = false;
  try {
    const url = html(pageHtml);
    await page.navigate(url);
    await fn(page, url);
    passed = true;
  } finally {
    // A failed test may leave an operation pending on the tab, which would
    // make the next borrower fail too: retire the tab instead of returning
    // it, and the next borrower opens a fresh one.
    if (passed) idlePages.push(page);
    else page.close();
  }
}

const todo = (name: string, fn: TestBody) => test.todo(name, fn);
const it = chromeAvailable
  ? (name: string, fn: TestBody) => test.concurrent(name, async () => tabLane(async () => fn()))
  : todo;
const itInChild = chromeAvailable ? (name: string, fn: TestBody) => test.concurrent(name, fn) : todo;
const itOnPage = chromeAvailable
  ? (name: string, pageHtml: string, fn: PageBody) =>
      test.concurrent(name, () => pageLane(() => onPooledPage(pageHtml, fn)))
  : (name: string, pageHtml: string, fn: PageBody) => todo(name, () => onPooledPage(pageHtml, fn));
/** Must be the only thing opening tabs while it runs: a plain (serial) test, placed after the concurrent ones. */
const itAlone = chromeAvailable ? test : test.todo;

if (chromeAvailable) {
  // Also where Chrome itself gets launched, so its startup is not charged to
  // whichever tests happen to run first.
  beforeAll(async () => {
    idlePages.push(...(await Promise.all(Array.from({ length: POOL_SIZE }, newPooledPage))));
  });
  afterAll(() => {
    for (const page of idlePages) page.close();
  });
}

// --- Assertion helpers ----------------------------------------------------------

/** What every error assertion compares: `code` is set on argument/state errors, absent on backend rejections. */
type ErrorShape = { name: string; code?: string; message: string };
const shapeOf = (e: any): ErrorShape => ({ name: e.name, code: e.code, message: e.message });
function thrown(fn: () => unknown): ErrorShape {
  try {
    fn();
  } catch (e) {
    return shapeOf(e);
  }
  throw new Error("expected the call to throw");
}
async function rejection(p: Promise<unknown>): Promise<ErrorShape & { stack?: string }> {
  try {
    await p;
  } catch (e: any) {
    return { ...shapeOf(e), stack: e.stack };
  }
  throw new Error("expected the promise to reject");
}
const invalidValue = (message: string): ErrorShape => ({ name: "TypeError", code: "ERR_INVALID_ARG_VALUE", message });
const invalidType = (message: string): ErrorShape => ({ name: "TypeError", code: "ERR_INVALID_ARG_TYPE", message });
const closedError = (method: string): ErrorShape => ({
  name: "Error",
  code: "ERR_INVALID_STATE",
  message: `Invalid state: WebView.${method}: view is closed`,
});

type TargetInfo = { targetId: string; url: string; attached: boolean };
/** Chrome's tab list, asked through any live view's session. Drops Chrome's own targets (extension workers, browser UI). */
async function pageTargets(probe: Bun.WebView): Promise<TargetInfo[]> {
  const { targetInfos } = await probe.cdp<{ targetInfos: (TargetInfo & { type: string })[] }>("Target.getTargets");
  return targetInfos.filter(t => t.type === "page").map(({ targetId, url, attached }) => ({ targetId, url, attached }));
}
async function ownTargetId(view: Bun.WebView): Promise<string> {
  const { targetInfo } = await view.cdp<{ targetInfo: TargetInfo }>("Target.getTargetInfo");
  return targetInfo.targetId;
}
/** close() fires Target.closeTarget without waiting for it, so poll the tab list until the tab has gone (~10ms). */
async function targetsOnceClosed(probe: Bun.WebView, closedTargetId: string): Promise<TargetInfo[]> {
  const deadline = Date.now() + 10_000;
  let targets = await pageTargets(probe);
  while (targets.some(t => t.targetId === closedTargetId) && Date.now() < deadline) targets = await pageTargets(probe);
  return targets;
}

const PNG_MAGIC = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
/** Width and height from the IHDR chunk, which always directly follows the 8-byte signature. */
function pngDimensions(png: Uint8Array): { width: number; height: number } {
  const view = new DataView(png.buffer, png.byteOffset, png.byteLength);
  return { width: view.getUint32(16), height: view.getUint32(20) };
}

// --- Option validation (throws before any I/O, so no Chrome needed) ---------

const connectAndSpawn = invalidValue(
  "backend.url (connect mode) cannot be combined with backend.path or backend.argv (spawn mode)",
);
const wsUrl = "ws://localhost:9222/devtools/browser/x";

test.each<[string, Bun.WebView.ConstructorOptions, ErrorShape]>([
  ['backend: "invalid"', { backend: "invalid" as any }, invalidValue('backend.type must be "webkit" or "chrome"')],
  [
    'backend.type: "invalid"',
    { backend: { type: "invalid" } as any },
    invalidValue('backend.type must be "webkit" or "chrome"'),
  ],
  ["backend.type: 123", { backend: { type: 123 } as any }, invalidType("backend.type must be a string")],
  [
    "backend.path: 123",
    { backend: { type: "chrome", path: 123 } as any },
    invalidType("backend.path must be a string"),
  ],
  [
    "backend.argv: [1]",
    { backend: { type: "chrome", argv: [1] } as any },
    invalidType("backend.argv entries must be strings"),
  ],
  [
    'backend.argv: "--x"',
    { backend: { type: "chrome", argv: "--x" } as any },
    invalidType("backend.argv must be an array of strings"),
  ],
  [
    'backend.stderr: "pipe"',
    { backend: { type: "chrome", stderr: "pipe" } as any },
    invalidValue('backend.stderr must be "inherit" or "ignore"'),
  ],
  [
    "backend.stderr: 123",
    { backend: { type: "chrome", stderr: 123 } as any },
    invalidType('backend.stderr must be "inherit" or "ignore"'),
  ],
  [
    'backend.stdout: "foo"',
    { backend: { type: "chrome", stdout: "foo" } as any },
    invalidValue('backend.stdout must be "inherit" or "ignore"'),
  ],
  [
    "backend.url together with backend.path",
    { backend: { type: "chrome", url: wsUrl, path: "/foo" } as any },
    connectAndSpawn,
  ],
  [
    "backend.url together with backend.argv",
    { backend: { type: "chrome", url: wsUrl, argv: ["--foo"] } as any },
    connectAndSpawn,
  ],
  [
    "console: 42",
    { backend: chrome, console: 42 as any },
    invalidType("console must be globalThis.console or a function"),
  ],
  [
    "console: {}",
    { backend: chrome, console: {} as any },
    invalidType("console must be globalThis.console or a function"),
  ],
  [
    "width: 0",
    { backend: chrome, width: 0 },
    {
      name: "RangeError",
      code: "ERR_OUT_OF_RANGE",
      message: 'The value of "width" is out of range. It must be >= 1 and <= 16384. Received 0',
    },
  ],
])("constructor rejects %s", (_label, options, error) => {
  expect(thrown(() => new Bun.WebView(options))).toEqual(error);
});

// --- One Chrome per bun process -----------------------------------------------------
//
// Launching a Chrome is by far the most expensive thing in this file, so the
// three tests below share one child bun process, launched on first use (not
// in beforeAll, so it overlaps the tab tests), and each looks at a different
// part of what it printed. The child spawns its Chrome through a launcher
// script that records the argv it was handed and then execs the real binary
// with it (exec keeps fds 3/4, the --remote-debugging-pipe ends, intact),
// prints the page's UA, forwards the page's console to its own stdio, and
// finally kills Chrome under a pending evaluate(). Defined first so it
// starts right away.

type SharedChild = { stdoutLines: string[]; stderr: string; exitCode: number | null; chromeArgv: string[] };
let sharedChild: Promise<SharedChild> | undefined;
function observeSharedChild(): Promise<SharedChild> {
  return (sharedChild ??= (async () => {
    using dir = tempDir("webview-chrome-spawn", {
      "launcher.sh": [
        "#!/bin/sh",
        `printf '%s\\n' "$@" > "$(dirname "$0")/argv.txt"`,
        `exec '${chromePath}' "$@"`,
        "",
      ].join("\n"),
    });
    chmodSync(join(String(dir), "launcher.sh"), 0o755);
    await using proc = Bun.spawn({
      cmd: [
        bunExe(),
        "-e",
        `
          const view = new Bun.WebView({
            backend: {
              type: "chrome",
              path: ${JSON.stringify(join(String(dir), "launcher.sh"))},
              argv: ["--user-agent=BunWebViewTest/1.0"],
            },
            console: globalThis.console,
            width: 200, height: 200,
          });
          await view.navigate("data:text/html,<body></body>");
          console.log(await view.evaluate("navigator.userAgent"));
          await view.evaluate("console.log('from page', 1, true)");
          await view.evaluate("console.error('page error')");
          const pending = view.evaluate("new Promise(() => {})");
          Bun.WebView.closeAll();
          console.log(await pending.then(() => "resolved", e => e.message));
        `,
      ],
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
      // Far above any real run; only so a child that hangs (taking its Chrome
      // with it) is reaped and reported instead of outliving the test run.
      timeout: 60_000,
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    // No argv.txt means the launcher never ran; the child's stderr and exit
    // code (in the console and closeAll tests' diffs) say why, so don't let
    // an ENOENT here hide them.
    const argvFile = join(String(dir), "argv.txt");
    const chromeArgv = existsSync(argvFile) ? readFileSync(argvFile, "utf8").trimEnd().split("\n") : [];
    return { stdoutLines: stdout.split("\n"), stderr, exitCode, chromeArgv };
  })());
}

itInChild("chrome: backend.path picks the executable and backend.argv lands after the core flags", async () => {
  // The launcher having run at all proves `path` was used; the argv it saw
  // shows where our flag landed; the UA shows Chrome honoured it.
  const { chromeArgv, stdoutLines } = await observeSharedChild();
  expect({
    coreFlags: chromeArgv.filter(flag => flag === "--remote-debugging-pipe" || flag === "--headless"),
    lastFlag: chromeArgv.at(-1),
    userAgent: stdoutLines[0],
  }).toEqual({
    coreFlags: ["--remote-debugging-pipe", "--headless"],
    lastFlag: "--user-agent=BunWebViewTest/1.0",
    userAgent: "BunWebViewTest/1.0",
  });
});

itInChild("chrome: console: globalThis.console forwards to the parent's stdout/stderr", async () => {
  // ConsoleClient::logWithLevel — Bun's own formatter applies, so the args
  // print exactly as a local console.log would; log → stdout, error →
  // stderr. stderr holding exactly that line is also the test for
  // backend.stderr defaulting to "ignore": Chrome prints GCM/updater/dbus
  // noise on every launch, and none of it may reach the bun process.
  const { stdoutLines, stderr } = await observeSharedChild();
  expect({ log: stdoutLines[1], stderr }).toEqual({ log: "from page 1 true", stderr: "page error\n" });
});

itInChild("chrome: closeAll() kills the subprocess and pending promises reject", async () => {
  // SIGKILL → socket EOF or the process-exit watcher, whichever the event
  // loop sees first → rejectAllAndMarkDead on the next tick. Both race
  // outcomes reject; only the message differs.
  const { stdoutLines, exitCode } = await observeSharedChild();
  expect(stdoutLines.slice(2)).toEqual([
    expect.stringMatching(/^(Chrome process closed the pipe|Chrome killed by signal 9)$/),
    "",
  ]);
  expect(exitCode).toBe(0);
});

// --- Construction + lifecycle ------------------------------------------------------

it("backend: chrome constructor returns a WebView; close() is idempotent and methods throw afterwards", () => {
  const view = new Bun.WebView({ backend: chrome, width: 400, height: 300 });
  expect(view).toBeInstanceOf(Bun.WebView);
  expect({ url: view.url, title: view.title, loading: view.loading, onNavigated: view.onNavigated }).toEqual({
    url: "",
    title: "",
    loading: false,
    onNavigated: null,
  });

  expect(view.close()).toBeUndefined();
  expect(view.close()).toBeUndefined();

  expect({
    navigate: thrown(() => view.navigate("about:blank")),
    evaluate: thrown(() => view.evaluate("1")),
    screenshot: thrown(() => view.screenshot()),
    cdp: thrown(() => view.cdp("Page.enable")),
    click: thrown(() => view.click(1, 1)),
    goBack: thrown(() => view.goBack()),
  }).toEqual({
    navigate: closedError("navigate"),
    evaluate: closedError("evaluate"),
    screenshot: closedError("screenshot"),
    cdp: closedError("cdp"),
    click: closedError("click"),
    goBack: closedError("goBack"),
  });
  // The getters keep working on a closed view.
  expect({ url: view.url, title: view.title, loading: view.loading }).toEqual({ url: "", title: "", loading: false });
});

it("backend: { type: 'chrome' } object form works", async () => {
  // path forces spawn-mode — without it, the bare object form would try to
  // auto-detect a DevToolsActivePort and connect to the dev's Chrome. (The
  // process is already in pipe mode via beforeAll, so this is the second+
  // view's case: the options are validated, the running Chrome is reused.)
  await using view = new Bun.WebView({ backend: { type: "chrome", path: chromePath }, width: 200, height: 200 });
  await view.navigate(html("<body>obj</body>"));
  expect(await view.evaluate("document.body.textContent")).toBe("obj");
});

it("chrome: navigate + evaluate round-trip on a fresh view", async () => {
  await using view = new Bun.WebView({ backend: chrome, width: 400, height: 300 });
  // First navigate kicks off the Target.createTarget → attachToTarget →
  // Page.enable → Page.navigate chain; awaiting it means the sessionId
  // is established and the load event fired. Subsequent ops go direct.
  const url = html("<h1 id=t>chrome</h1>");
  expect(await view.navigate(url)).toBeUndefined();
  expect(view.url).toBe(url);
  expect(await view.evaluate("document.getElementById('t').textContent")).toBe("chrome");
});

it("chrome: two views have independent sessions; closing one leaves the other intact", async () => {
  await using a = new Bun.WebView({ backend: chrome, width: 200, height: 200 });
  await using b = new Bun.WebView({ backend: chrome, width: 200, height: 200 });
  // Each view has its own Target → its own sessionId → its own page.
  await Promise.all([a.navigate(html("<body>A</body>")), b.navigate(html("<body>B</body>"))]);
  expect(await Promise.all([a.evaluate("document.body.textContent"), b.evaluate("document.body.textContent")])).toEqual(
    ["A", "B"],
  );
  const [aTarget, bTarget] = await Promise.all([ownTargetId(a), ownTargetId(b)]);
  expect(aTarget).not.toBe(bTarget);

  a.close();
  const remaining = await targetsOnceClosed(b, aTarget);
  expect(remaining.find(t => t.targetId === aTarget)).toBeUndefined();
  expect(remaining.find(t => t.targetId === bTarget)).toMatchObject({ attached: true });
  expect(await b.evaluate("document.body.textContent")).toBe("B");
});

itOnPage("chrome: close() rejects pending promises and closes the tab", "<body>probe</body>", async probe => {
  // The pooled page only serves as the session through which Chrome's tab
  // list is read once the view under test is gone.
  await using view = new Bun.WebView({ backend: chrome, width: 200, height: 200 });
  await view.navigate(html("<body></body>"));
  const targetId = await ownTargetId(view);

  // A page-side promise that never settles keeps the Evaluate slot busy...
  const pending = view.evaluate("new Promise(() => {})");
  expect(thrown(() => view.evaluate("1"))).toEqual({
    name: "Error",
    code: "ERR_INVALID_STATE",
    message: "Invalid state: an evaluate() is already pending",
  });
  // ...until close() settles every slot.
  view.close();
  expect(await rejection(pending)).toMatchObject({ name: "Error", message: "WebView closed" });
  expect(thrown(() => view.evaluate("1"))).toEqual(closedError("evaluate"));

  // close() also sent Target.closeTarget: the tab disappears from Chrome.
  const remaining = await targetsOnceClosed(probe, targetId);
  expect(remaining.find(t => t.targetId === targetId)).toBeUndefined();
});

// --- evaluate() -----------------------------------------------------------------------

itOnPage("chrome: evaluate returns native JS values", "<body></body>", async page => {
  // Runtime.evaluate with returnByValue serializes the result page-side;
  // handleResponse's Method::RuntimeEvaluate arm JSONParses it. Only one
  // evaluate() may be in flight per view, hence sequential.
  const results: unknown[] = [];
  for (const expression of [
    "42",
    "'hello'",
    "[1, 2, 3]",
    "({a: 1, b: [true, null]})",
    "null",
    "undefined",
    "true",
    "0",
    "''",
  ])
    results.push(await page.evaluate(expression));
  expect(results).toEqual([42, "hello", [1, 2, 3], { a: 1, b: [true, null] }, null, undefined, true, 0, ""]);
});

itOnPage("chrome: evaluate awaits Promises", "<body></body>", async page => {
  // awaitPromise:true + the (async()=>{return await (...)})() wrap.
  expect(await page.evaluate("Promise.resolve(42)")).toBe(42);
  expect(await page.evaluate("new Promise(r => setTimeout(() => r('delayed'), 5))")).toBe("delayed");
  expect(await rejection(page.evaluate("Promise.reject(new Error('boom'))"))).toEqual({
    name: "Error",
    message: "boom",
    stack: expect.stringMatching(/^Error: boom\n/),
  });
});

itOnPage("chrome: large evaluate payload crosses the pipe in both directions", "<body></body>", async page => {
  // 100KB each way. The socketpair buffer is ~256KB by default; a single
  // write may EAGAIN partway through. The tx queue + onWritable drain
  // handles it, and the reply is reassembled from several reads.
  const big = Buffer.alloc(100_000, "x").toString();
  expect(await page.evaluate(JSON.stringify(big))).toBe(big);
});

itOnPage("chrome: evaluate() throwing Error carries page-side stack", "<body></body>", async page => {
  // CDP exceptionDetails.exception.description is V8's formatted stack.
  // errorFromExceptionDetails takes the text after "Error: " on its first
  // line as .message and stamps the whole description on .stack — the user
  // sees page frames, not the test callsite. Statement sequences need an
  // IIFE because evaluate() wraps the script in `await (...)`.
  const error = await rejection(
    page.evaluate(
      `(() => {
          function inner() { throw new Error("page boom"); }
          function outer() { inner(); }
          outer();
        })()`,
    ),
  );
  expect(error).toEqual({
    name: "Error",
    message: "page boom",
    stack: expect.stringMatching(/^Error: page boom\n.*at inner \(.*\n.*at outer \(/),
  });
});

itOnPage("chrome: evaluate() rejected Promise carries rejection reason", "<body></body>", async page => {
  // The page-side class survives only in the description; the rejection
  // itself is a plain Error.
  expect(await rejection(page.evaluate("Promise.reject(new TypeError('bad'))"))).toEqual({
    name: "Error",
    message: "bad",
    stack: expect.stringMatching(/^TypeError: bad\n/),
  });
});

itOnPage("chrome: evaluate() rejects what returnByValue can't serialize", "<body></body>", async page => {
  // V8 refuses to serialize the cycle; Chrome answers with a CDP error
  // ("Object reference chain is too long") which becomes the rejection. The
  // wording is Chrome's, so only its gist is pinned.
  const circular = await rejection(page.evaluate("(() => { const a = {}; a.self = a; return a; })()"));
  expect(circular.message).toMatch(/reference chain|circular/i);
  // evaluate() takes an expression: statements fail to parse inside the
  // `await (...)` wrapper and the page-side SyntaxError is the rejection.
  const statements = await rejection(page.evaluate("const a = 1; a"));
  expect(statements.stack).toStartWith("SyntaxError: ");
});

// --- Screenshots -------------------------------------------------------------------------

itOnPage(
  "chrome: screenshot formats produce the right MIME type and magic bytes",
  // Gradient + text gives the lossy encoders something to work with.
  "<body style='background:linear-gradient(red,blue);color:white;font-size:40px'>Hello</body>",
  async page => {
    const png = await page.screenshot();
    expect(png).toBeInstanceOf(Blob);
    const pngBytes = await png.bytes();
    expect({ type: png.type, magic: [...pngBytes.subarray(0, 8)], size: pngDimensions(pngBytes) }).toEqual({
      type: "image/png",
      magic: PNG_MAGIC,
      size: { width: PAGE_SIZE, height: PAGE_SIZE },
    });

    const jpeg = await page.screenshot({ format: "jpeg", quality: 90 });
    expect({ type: jpeg.type, magic: [...(await jpeg.bytes()).subarray(0, 3)] }).toEqual({
      type: "image/jpeg",
      magic: [0xff, 0xd8, 0xff],
    });

    const webp = await page.screenshot({ format: "webp", quality: 80 });
    const webpBytes = await webp.bytes();
    // WebP magic: "RIFF" <4-byte size> "WEBP"
    const ascii = (start: number) => new TextDecoder().decode(webpBytes.subarray(start, start + 4));
    expect({ type: webp.type, riff: ascii(0), webp: ascii(8) }).toEqual({
      type: "image/webp",
      riff: "RIFF",
      webp: "WEBP",
    });

    // quality reaches Page.captureScreenshot: the same page encodes smaller
    // at a lower setting.
    const lo = await page.screenshot({ format: "jpeg", quality: 10 });
    const hi = await page.screenshot({ format: "jpeg", quality: 95 });
    expect(lo.size).toBeLessThan(hi.size);

    expect(thrown(() => page.screenshot({ format: "gif" as any }))).toEqual(
      invalidValue('format must be "png", "jpeg", or "webp"'),
    );
    expect(thrown(() => page.screenshot({ quality: 101 }))).toEqual({
      name: "RangeError",
      code: "ERR_OUT_OF_RANGE",
      message: 'The value of "quality" is out of range. It must be >= 0 and <= 100. Received 101',
    });
  },
);

itOnPage("chrome: screenshot encodings all carry the same PNG", "<body style='background:red'></body>", async page => {
  // A static solid page encodes identically on every capture, so each
  // encoding can be compared byte-for-byte against the default Blob.
  const png = Buffer.from(await (await page.screenshot()).bytes());
  expect([...png.subarray(0, 8)]).toEqual(PNG_MAGIC);

  const buffer = await page.screenshot({ encoding: "buffer" });
  expect(Buffer.isBuffer(buffer)).toBe(true);
  expect(buffer.equals(png)).toBe(true);

  // base64 — zero decode (CDP returns base64 natively).
  const base64 = await page.screenshot({ encoding: "base64" });
  expect(typeof base64).toBe("string");
  expect(Buffer.from(base64, "base64").equals(png)).toBe(true);

  // shmem — a segment the parent creates after decoding (Chrome itself
  // doesn't use shm here); the bun-chrome- prefix tells it apart from
  // WebKit's child-created segments. It stays linked for the consumer
  // (Kitty shm_open's it, then unlinks), so the test owns the cleanup.
  if (process.platform !== "win32") {
    const shm = await page.screenshot({ encoding: "shmem" });
    try {
      expect(shm).toEqual({ name: expect.stringMatching(/^\/bun-chrome-\d+-\d+$/), size: png.length });
      if (process.platform === "linux") expect(readFileSync("/dev/shm" + shm.name).equals(png)).toBe(true);
    } finally {
      shmUnlinkChrome(shm.name);
    }
  }

  expect(thrown(() => page.screenshot({ encoding: "hex" as any }))).toEqual(
    invalidValue('encoding must be "blob", "buffer", "base64", or "shmem"'),
  );
});

// --- cdp() ----------------------------------------------------------------------------------

itOnPage("chrome: cdp() raw passthrough", "<body><input id=q value='hello'></body>", async page => {
  // DOM.getDocument → root node. The result shape is documented CDP.
  const { root } = await page.cdp<{ root: { nodeId: number; nodeType: number; nodeName: string } }>("DOM.getDocument");
  expect({ nodeType: root.nodeType, nodeName: root.nodeName, nodeId: typeof root.nodeId }).toEqual({
    nodeType: 9,
    nodeName: "#document",
    nodeId: "number",
  });

  // DOM.querySelector chained through the nodeId.
  const { nodeId } = await page.cdp<{ nodeId: number }>("DOM.querySelector", { nodeId: root.nodeId, selector: "#q" });
  expect(nodeId).toBeGreaterThan(0);

  // Runtime.evaluate — same mechanism as page.evaluate(), but the raw CDP
  // result object comes back, decoded as-is.
  const evaluated = await page.cdp("Runtime.evaluate", {
    expression: "document.querySelector('#q').value",
    returnByValue: true,
  });
  expect(evaluated).toEqual({ result: { type: "string", value: "hello" } });

  // Chrome's -32601 error response becomes the rejection, message verbatim.
  expect((await rejection(page.cdp("NotADomain.nope"))).message).toMatch(/'NotADomain\.nope' wasn't found/);

  // Empty result object (Input.* style) resolves {}.
  expect(await page.cdp("Page.bringToFront")).toEqual({});
});

itOnPage("chrome: cdp() guards — before navigate and params validation", "<body></body>", async page => {
  // No sessionId until a first navigate has run the attach chain. (A view
  // that is never navigated never gets a tab, so this costs nothing.)
  using fresh = new Bun.WebView({ backend: chrome, width: 100, height: 100 });
  expect(thrown(() => fresh.cdp("Page.enable"))).toEqual({
    name: "Error",
    code: "ERR_INVALID_STATE",
    message: "Invalid state: WebView.cdp(): no session - await navigate() first",
  });

  // params must JSON.stringify to an object; rejected before any I/O.
  const badParams = invalidType("params must be a JSON-serializable object");
  expect(thrown(() => page.cdp("Page.enable", 42 as any))).toEqual(badParams);
  expect(thrown(() => page.cdp("Page.enable", [1] as any))).toEqual(badParams);
  // Still usable afterwards.
  expect(await page.cdp("Page.enable")).toEqual({});
});

it("chrome: cdp() enable + addEventListener receives CDP events", async () => {
  await using view = new Bun.WebView({ backend: chrome, width: 200, height: 200 });
  // First navigate to get a sessionId (cdp() guards before that).
  await view.navigate(html("<body>init</body>"));

  // Network.enable starts streaming. The listener type IS the CDP method
  // name — handleEvent's fallthrough dispatches any non-internal event as
  // a MessageEvent with the params as .data.
  await view.cdp("Network.enable");
  const events: unknown[] = [];
  const onRequest = (e: MessageEvent<{ requestId: string; type: string; request: { url: string; method: string } }>) =>
    events.push({
      eventType: e.type,
      requestId: typeof e.data.requestId,
      resourceType: e.data.type,
      request: { url: e.data.request.url, method: e.data.request.method },
    });
  view.addEventListener("Network.requestWillBeSent", onRequest);

  // A data: navigation makes exactly one request, the document itself.
  // navigate() resolves on Page.loadEventFired, which Chrome sends after
  // the Network event, so the listener has run by the time it returns.
  const second = html("<body>second</body>");
  await view.navigate(second);
  expect(events).toEqual([
    {
      eventType: "Network.requestWillBeSent",
      requestId: "string",
      resourceType: "Document",
      request: { url: second, method: "GET" },
    },
  ]);

  // removeEventListener stops delivery: the third navigate produces the
  // same traffic but nothing more is recorded.
  view.removeEventListener("Network.requestWillBeSent", onRequest);
  await view.navigate(html("<body>third</body>"));
  expect(events).toHaveLength(1);
});

// --- Input ------------------------------------------------------------------------------------

itOnPage(
  "chrome: click dispatches mousedown/mouseup/click",
  `
    <script>
      window.__ev = [];
      document.addEventListener("mousedown", e => __ev.push("down:" + e.isTrusted), true);
      document.addEventListener("mouseup", e => __ev.push("up:" + e.isTrusted), true);
      document.addEventListener("click", e => __ev.push("click:" + e.isTrusted), true);
    </script>
    <button style="position:fixed;left:0;top:0;width:100px;height:100px">btn</button>
  `,
  async page => {
    // Input.dispatchMouseEvent is sync-reply — Chrome processes the event and
    // THEN replies, so the handlers have run once click() resolves.
    expect(await page.click(50, 50)).toBeUndefined();
    expect(await page.evaluate("__ev")).toEqual(["down:true", "up:true", "click:true"]);
  },
);

itOnPage(
  "chrome: click(selector) waits for actionability, clicks center",
  `
    <script>
      window.__ev = [];
      document.addEventListener("click", e => __ev.push({
        trusted: e.isTrusted, x: e.clientX, y: e.clientY, target: e.target.id,
      }), true);
    </script>
    <button id=btn style="position:fixed;left:40px;top:60px;width:100px;height:80px">btn</button>
  `,
  async page => {
    // Same rAF-polled actionability predicate as WKWebView. Two-phase:
    // Runtime.evaluate → [cx, cy] → Input.dispatchMouseEvent down+up.
    await page.click("#btn");
    expect(await page.evaluate("__ev")).toEqual([{ trusted: true, x: 90, y: 100, target: "btn" }]);
  },
);

itOnPage(
  "chrome: click(selector) waits for element to appear",
  `
    <script>
      window.__clicked = 0;
      let n = 0;
      requestAnimationFrame(function tick() {
        if (++n < 3) return requestAnimationFrame(tick);
        const b = document.createElement("button");
        b.id = "late";
        b.onclick = () => __clicked++;
        b.style.cssText = "position:fixed;left:0;top:0;width:50px;height:50px";
        document.body.appendChild(b);
      });
    </script>
  `,
  async page => {
    await page.click("#late");
    expect(await page.evaluate("__clicked")).toBe(1);
  },
);

itOnPage(
  "chrome: click(selector) rejects on timeout when obscured",
  `
    <button id=under onclick="window.__hit = 'under'" style="position:fixed;left:0;top:0;width:100px;height:100px">under</button>
    <div onclick="window.__hit = 'overlay'" style="position:fixed;left:0;top:0;width:100px;height:100px;background:red">overlay</div>
  `,
  async page => {
    // elementFromPoint returns the overlay — actionability never passes, the
    // injected IIFE throws its timeout message and that is the rejection.
    // Nothing gets clicked on the way out.
    expect(await rejection(page.click("#under", { timeout: 200 }))).toMatchObject({
      name: "Error",
      message: "timeout waiting for '#under' to be actionable",
    });
    expect(await page.evaluate("typeof window.__hit")).toBe("undefined");
  },
);

itOnPage(
  "chrome: click(selector)/scrollTo(selector) reject invalid and empty selectors",
  "<body></body>",
  async page => {
    // querySelector throws a SyntaxError page-side; the IIFE rejects with it.
    expect((await rejection(page.click(":::invalid"))).message).toMatch(/not a valid selector/);
    expect((await rejection(page.scrollTo(":::invalid"))).message).toMatch(/not a valid selector/);
    // Empty selectors are refused before anything is sent.
    const empty = invalidValue("The argument 'selector' must not be empty. Received ''");
    expect(thrown(() => page.click(""))).toEqual(empty);
    expect(thrown(() => page.scrollTo(""))).toEqual(empty);
  },
);

itOnPage(
  "chrome: click with right button fires contextmenu",
  `
    <script>
      window.__ev = new Promise(r =>
        document.addEventListener("contextmenu", e => { e.preventDefault(); r({button: e.button, trusted: e.isTrusted}); }, {once: true}));
    </script>
    <div style="position:fixed;left:0;top:0;width:200px;height:200px"></div>
  `,
  async page => {
    // button: "right" → cdpButton(1) = "right" → Chrome fires contextmenu.
    await page.click(100, 100, { button: "right" });
    expect(await page.evaluate("__ev")).toEqual({ button: 2, trusted: true });
  },
);

itOnPage(
  "chrome: click with modifiers sets MouseEvent flags",
  `
    <script>
      window.__ev = new Promise(r =>
        document.addEventListener("click", e => r({shift: e.shiftKey, ctrl: e.ctrlKey, alt: e.altKey, meta: e.metaKey}), {once: true}));
    </script>
    <div style="position:fixed;left:0;top:0;width:200px;height:200px"></div>
  `,
  async page => {
    await page.click(100, 100, { modifiers: ["Shift", "Meta"] });
    expect(await page.evaluate("__ev")).toEqual({ shift: true, ctrl: false, alt: false, meta: true });
  },
);

itOnPage(
  "chrome: click(selector) is injection-safe",
  // The selector below contains double-quote + close-paren + close-brace —
  // characters that would break naive `")(sel,${timeout})` interpolation
  // into the IIFE call-site. appendQuotedJSONString escapes the quote; the
  // parens/braces are inert inside a JSON string.
  `<button data-k='x")}' onclick="window.__hit = 1" style="position:fixed;left:0;top:0;width:50px;height:50px"></button>`,
  async page => {
    await page.click(`[data-k='x")}']`);
    expect(await page.evaluate("window.__hit")).toBe(1);
  },
);

itOnPage(
  "chrome: click(selector) waits for animation to stop",
  `
    <style>
      @keyframes slide { from { left: 0; } to { left: 100px; } }
      #mover { position: fixed; top: 50px; width: 60px; height: 60px;
               animation: slide 200ms linear forwards; }
    </style>
    <button id=mover onclick="window.__left = this.getBoundingClientRect().left">mv</button>
  `,
  async page => {
    // A new animation holds its first keyframe until the compositor assigns
    // it a start time, and two samples taken inside that window look
    // "stable" too; so only click once the element is actually in motion.
    await page.evaluate("document.getElementById('mover').getAnimations()[0].ready.then(() => 'running')");
    // Stable-for-2-frames check — the click lands after the animation stops.
    await page.click("#mover");
    expect(await page.evaluate("__left")).toBe(100);
  },
);

itOnPage("chrome: type inserts text at focused element", "<input id=i>", async page => {
  // Input.insertText inserts at the caret, so something must be focused.
  // autofocus only applies on user-initiated loads; focus explicitly.
  await page.evaluate("document.getElementById('i').focus()");
  expect(await page.type("hello")).toBeUndefined();
  expect(await page.evaluate("document.getElementById('i').value")).toBe("hello");
});

itOnPage(
  "chrome: press() dispatches keydown/keyup pair",
  `
    <script>
      window.__keys = [];
      addEventListener("keydown", e => __keys.push("d:" + e.key));
      addEventListener("keyup", e => __keys.push("u:" + e.key));
    </script>
  `,
  async page => {
    // Named key (rawKeyDown — no text, just keydown/keyup).
    await page.press("Escape");
    // Text-producing key (keyDown — fires keydown + input).
    await page.press("Enter");
    expect(await page.evaluate("__keys")).toEqual(["d:Escape", "u:Escape", "d:Enter", "u:Enter"]);
  },
);

itOnPage(
  "chrome: press() with modifiers",
  `
    <script>
      window.__ev = new Promise(r =>
        addEventListener("keydown", e => r({key: e.key, shift: e.shiftKey, ctrl: e.ctrlKey}), {once: true}));
    </script>
  `,
  async page => {
    await page.press("ArrowLeft", { modifiers: ["Shift", "Control"] });
    expect(await page.evaluate("__ev")).toEqual({ key: "ArrowLeft", shift: true, ctrl: true });
  },
);

itOnPage("chrome: scroll dispatches wheel event", "<body style='height:2000px'></body>", async page => {
  await page.scroll(0, 100);
  // Input.dispatchMouseEvent's reply means the event was QUEUED — the
  // compositor applies the scroll asynchronously. Playwright's own wheel
  // tests do page.waitForFunction('window.scrollY === 100') for exactly
  // this reason (wheel.spec.ts:56). Our evaluate() awaits a page-side
  // promise; rAF-polling until scrollY > 0 is the same mechanism.
  //
  // Not checking the exact value — Chromium on macOS scales deltaY by the
  // device pixel ratio (crbug/1324819; Playwright skips delta assertions on
  // mac+chromium for this reason, wheel.spec.ts:26). scrollY > 0 proves
  // the trusted wheel reached the compositor and scrolled.
  const y = await page.evaluate<number>(`
    new Promise((resolve, reject) => {
      const deadline = performance.now() + 2000;
      requestAnimationFrame(function tick() {
        if (window.scrollY > 0) return resolve(window.scrollY);
        if (performance.now() > deadline) return reject("scrollY never moved");
        requestAnimationFrame(tick);
      });
    })
  `);
  expect(y).toBeGreaterThan(0);
});

itOnPage(
  "chrome: scrollTo(selector) aligns the element per `block`",
  `
    <div style="height:1000px"></div>
    <div id=t style="height:100px;background:red">target</div>
    <div style="height:1000px"></div>
  `,
  async page => {
    // scrollIntoView runs page-side — the IIFE waits for the element, then
    // scrolls atomically. Each case starts from the top of the document; the
    // expected numbers follow from the PAGE_SIZE-tall viewport and the
    // 100px element.
    const results: unknown[] = [];
    for (const block of [undefined, "start", "center", "end", "nearest"] as const) {
      await page.evaluate("window.scrollTo(0, 0)");
      await page.scrollTo("#t", block && { block });
      const rect = await page.evaluate<{ top: number; bottom: number }>(
        "(r => ({ top: Math.round(r.top), bottom: Math.round(r.bottom) }))(document.getElementById('t').getBoundingClientRect())",
      );
      results.push({ block, ...rect });
    }
    expect(results).toEqual([
      { block: undefined, top: 100, bottom: 200 }, // the default is center
      { block: "start", top: 0, bottom: 100 },
      { block: "center", top: 100, bottom: 200 },
      { block: "end", top: 200, bottom: 300 },
      { block: "nearest", top: 200, bottom: 300 }, // coming from above, the nearest edge is the bottom
    ]);

    // A selector that never matches times out with the injected message.
    expect(await rejection(page.scrollTo("#missing", { timeout: 100 }))).toMatchObject({
      name: "Error",
      message: "timeout waiting for '#missing'",
    });
  },
);

// --- Navigation -------------------------------------------------------------------------

itOnPage(
  "chrome: url/title getters reflect the committed document",
  "<title>Page Title</title><body>hi</body>",
  async (page, url) => {
    // m_url comes from Page.frameNavigated; Page.loadEventFired chains a
    // Runtime.evaluate("document.title") before settling, so both are
    // populated when navigate() resolves — the same guarantee as WKWebView's
    // NavDone packing url+title.
    expect({ url: page.url, title: page.title, loading: page.loading }).toEqual({
      url,
      title: "Page Title",
      loading: false,
    });
    const second = html("<title>Second</title>");
    await page.navigate(second);
    expect({ url: page.url, title: page.title, loading: page.loading }).toEqual({
      url: second,
      title: "Second",
      loading: false,
    });
  },
);

it("chrome: onNavigated fires with the committed URL before navigate() resolves", async () => {
  await using view = new Bun.WebView({ backend: chrome, width: 200, height: 200 });
  const seen: string[] = [];
  view.onNavigated = (url: string) => seen.push(url);
  const url = html("<body>test</body>");
  await view.navigate(url);
  // The tab starts life on about:blank (Target.createTarget); whether that
  // commit is reported depends on whether it lands after Page.enable, so it
  // is the one entry allowed besides ours.
  expect(seen.filter(u => u !== "about:blank")).toEqual([url]);
});

it("chrome: navigate() rejects with Chrome's error when the load fails to start", async () => {
  await using view = new Bun.WebView({ backend: chrome, width: 200, height: 200 });
  await view.navigate(html("<body></body>"));
  // Port 1 is on Chrome's restricted-port list, so this fails inside the
  // network stack (net::ERR_UNSAFE_PORT) without opening a socket;
  // Page.navigate answers with errorText, which becomes the rejection.
  expect((await rejection(view.navigate("http://127.0.0.1:1/"))).message).toMatch(/^net::ERR_/);
});

itOnPage("chrome: reload resolves once the fresh document has loaded", "<body>original</body>", async page => {
  await page.evaluate("(window.__stale = true, document.body.textContent = 'mutated')");
  // reload uses PendingSlot::Navigate — Page.loadEventFired settles it, so
  // the evaluate() below runs in the new document: the mutation is gone and
  // the global was never set there.
  expect(await page.reload()).toBeUndefined();
  expect(await page.evaluate("({ stale: typeof window.__stale, body: document.body.textContent })")).toEqual({
    stale: "undefined",
    body: "original",
  });
});

itOnPage("chrome: sequential navigates work", "<body>start</body>", async page => {
  const visited: unknown[] = [];
  for (const body of ["A", "B", "C"]) {
    const url = html(`<body>${body}</body>`);
    await page.navigate(url);
    visited.push({
      body: await page.evaluate("document.body.textContent"),
      url: page.url === url ? "matches" : page.url,
    });
  }
  expect(visited).toEqual([
    { body: "A", url: "matches" },
    { body: "B", url: "matches" },
    { body: "C", url: "matches" },
  ]);
});

itOnPage("chrome: goBack/goForward navigate history", "<body>start</body>", async page => {
  const urls = { A: html("<body>A</body>"), B: html("<body>B</body>"), C: html("<body>C</body>") };
  await page.navigate(urls.A);
  await page.navigate(urls.B);
  await page.navigate(urls.C);
  // Page.getNavigationHistory → entries[currentIndex ± 1].id →
  // Page.navigateToHistoryEntry → loadEventFired settles.
  const visited: unknown[] = [];
  const record = async () => visited.push({ body: await page.evaluate("document.body.textContent"), url: page.url });
  await page.goBack();
  await record();
  await page.goBack();
  await record();
  await page.goForward();
  await record();
  expect(visited).toEqual([
    { body: "B", url: urls.B },
    { body: "A", url: urls.A },
    { body: "B", url: urls.B },
  ]);
});

it("chrome: goBack at history start resolves undefined (no-op)", async () => {
  await using view = new Bun.WebView({ backend: chrome, width: 200, height: 200 });
  await view.navigate(html("<body>only</body>"));
  // Target.createTarget({url:"about:blank"}) means history[0] = about:blank
  // and history[1] = our page, so one goBack lands on about:blank...
  await view.goBack();
  const where = async () => ({ url: view.url, body: await view.evaluate("document.body.textContent") });
  expect(await where()).toEqual({ url: "about:blank", body: "" });
  // ...and the next one hits the boundary: resolves undefined without
  // navigating, same as WKWebView's no-op.
  expect(await view.goBack()).toBeUndefined();
  expect(await where()).toEqual({ url: "about:blank", body: "" });
});

it("chrome: resize changes the viewport and what screenshot() captures", async () => {
  await using view = new Bun.WebView({ backend: chrome, width: 300, height: 300 });
  await view.navigate(html("<body></body>"));
  // Emulation.setDeviceMetricsOverride — the reply means the metrics are
  // applied: the page lays out at the new size and Page.captureScreenshot
  // renders the emulated viewport.
  expect(await view.resize(500, 400)).toBeUndefined();
  expect(await view.evaluate("({w: innerWidth, h: innerHeight})")).toEqual({ w: 500, h: 400 });
  expect(pngDimensions(await (await view.screenshot()).bytes())).toEqual({ width: 500, height: 400 });
});

// --- Console capture --------------------------------------------------------------------

it("chrome: console callback receives (type, ...args)", async () => {
  const calls: unknown[][] = [];
  await using view = new Bun.WebView({
    backend: chrome,
    width: 200,
    height: 200,
    console: (type: string, ...args: unknown[]) => calls.push([type, ...args]),
  });
  await view.navigate(html("<body></body>"));
  // Runtime.consoleAPICalled fires per console.* call, and Chrome sends it
  // before the evaluate's own reply, so each call has been delivered once
  // its evaluate() resolves. Primitives unwrap to raw values; objects arrive
  // as the CDP RemoteObject, preview included.
  await view.evaluate("console.log('hello', 42, true)");
  await view.evaluate("console.warn('warning', {a: 1})");
  await view.evaluate("console.error('boom')");
  expect(calls).toEqual([
    ["log", "hello", 42, true],
    [
      "warning",
      "warning",
      expect.objectContaining({
        type: "object",
        className: "Object",
        preview: expect.objectContaining({ properties: [{ name: "a", type: "number", value: "1" }] }),
      }),
    ],
    ["error", "boom"],
  ]);
});

// --- Runs alone: observes the whole tab list, so nothing else may be opening tabs ---

itAlone("chrome: close() during the attach chain stops the chain", async () => {
  // close() settles the slots and prunes this view's m_pending entries, so
  // when the Target.createTarget reply arrives nothing continues the chain
  // (attachToTarget → Page.enable → Page.navigate). If something did, the
  // tab would show up attached, navigate to our URL and fire onNavigated on
  // a closed view. The pool is idle by now, so one of its tabs is the probe
  // (a fresh one only if failing tests retired them all).
  if (idlePages.length === 0) idlePages.push(await newPooledPage());
  const probe = idlePages[0];
  const before = new Set((await pageTargets(probe)).map(t => t.targetId));

  const navigated: string[] = [];
  await using view = new Bun.WebView({ backend: chrome, width: 100, height: 100 });
  view.onNavigated = (url: string) => navigated.push(url);
  const navigation = view.navigate(html("<body>leaked</body>")); // sends Target.createTarget...
  view.close(); // ...and closes before its reply arrives
  expect(await rejection(navigation)).toMatchObject({ name: "Error", message: "WebView closed" });

  // Ordering instead of a sleep: Target.* commands are handled by the
  // browser in the order they arrive on the one pipe. createTarget went out
  // before the probe's first round trip, so its reply was processed here
  // before that round trip's reply; had it (wrongly) been answered with
  // attachToTarget, Chrome would have handled that before the second round
  // trip's getTargets.
  await pageTargets(probe);
  const created = (await pageTargets(probe)).filter(t => !before.has(t.targetId));
  // createTarget itself still goes through (Chrome opens the tab before we
  // learn its id), but the chain never touched what it opened: anything new
  // is an unattached tab still on about:blank.
  expect(created.filter(t => t.attached || t.url !== "about:blank")).toEqual([]);
  expect(navigated).toEqual([]);
});

test("WebView.closeAll is a static function", () => {
  expect(typeof Bun.WebView.closeAll).toBe("function");
  // Kept last: with Chrome installed this SIGKILLs the Chrome every test
  // above shared; without it, it exercises the nothing-to-kill path.
  expect(Bun.WebView.closeAll()).toBeUndefined();
});
