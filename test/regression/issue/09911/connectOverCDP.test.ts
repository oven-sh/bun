// https://github.com/oven-sh/bun/issues/9911
//
// Playwright's connectOverCDP() bundles the real `ws` package, which performs
// its handshake via http.request() + req.on("upgrade"). This is an end-to-end
// check against a real Chrome with --remote-debugging-port.
import { describe, expect, setDefaultTimeout, test } from "bun:test";
import { bunEnv, bunExe, isWindows, tempDir } from "harness";
import { accessSync, constants as fsConstants } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

// `bun install` of playwright-core and Chrome startup can exceed the 5s
// default timeout on slow CI workers.
setDefaultTimeout(60_000);

function findChrome(): string | undefined {
  const ok = (p: string) => {
    try {
      accessSync(p, fsConstants.X_OK);
      return true;
    } catch {
      return false;
    }
  };
  if (process.env.BUN_CHROME_PATH) return ok(process.env.BUN_CHROME_PATH) ? process.env.BUN_CHROME_PATH : undefined;
  for (const n of ["google-chrome-stable", "google-chrome", "chromium-browser", "chromium", "chrome"]) {
    const found = Bun.which(n);
    if (found) return found;
  }
  if (process.platform === "darwin") {
    for (const b of ["Google Chrome.app/Contents/MacOS/Google Chrome", "Chromium.app/Contents/MacOS/Chromium"]) {
      for (const root of ["/Applications", join(homedir(), "Applications")]) {
        const p = join(root, b);
        if (ok(p)) return p;
      }
    }
  } else if (process.platform === "linux") {
    for (const p of ["/usr/bin/google-chrome-stable", "/usr/bin/google-chrome", "/usr/bin/chromium"]) {
      if (ok(p)) return p;
    }
  }
  return undefined;
}

const chromePath = findChrome();

describe.todoIf(!chromePath || isWindows)("playwright connectOverCDP via Chrome", () => {
  async function setup() {
    const dir = tempDir("issue-09911-cdp", {
      "package.json": JSON.stringify({ dependencies: { "playwright-core": "1.58.2" } }),
      "connect.mjs": `
        const { chromium } = require("playwright-core");
        const browser = await chromium.connectOverCDP(process.argv[2], { timeout: 15000 });
        const context = browser.contexts()[0] ?? (await browser.newContext());
        const page = await context.newPage();
        await page.goto("data:text/html,<title>cdp-ok</title>");
        console.log("TITLE", await page.title());
        await browser.close();
      `,
    });
    let userDataDir: ReturnType<typeof tempDir> | undefined;
    let chrome: ReturnType<typeof Bun.spawn> | undefined;
    try {
      const install = Bun.spawn({
        cmd: [bunExe(), "install"],
        env: bunEnv,
        cwd: String(dir),
        stdout: "ignore",
        // ignore instead of pipe so large install output can't deadlock on a
        // full pipe buffer while we await exited.
        stderr: "ignore",
      });
      expect(await install.exited).toBe(0);

      userDataDir = tempDir("issue-09911-chrome-profile", {});
      chrome = Bun.spawn({
        cmd: [
          chromePath!,
          "--headless=new",
          "--remote-debugging-port=0",
          "--no-first-run",
          "--no-default-browser-check",
          "--user-data-dir=" + String(userDataDir),
        ],
        env: bunEnv,
        stdout: "ignore",
        stderr: "pipe",
      });

      let wsEndpoint = "";
      for await (const chunk of chrome.stderr) {
        const m = Buffer.from(chunk)
          .toString()
          .match(/DevTools listening on (ws:\/\/[\w.:/-]+)/);
        if (m) {
          wsEndpoint = m[1];
          break;
        }
      }
      expect(wsEndpoint).not.toBe("");

      const capturedUserDataDir = userDataDir;
      const capturedChrome = chrome;
      return {
        dir,
        chrome,
        wsEndpoint,
        [Symbol.dispose]() {
          capturedChrome.kill();
          dir[Symbol.dispose]();
          capturedUserDataDir[Symbol.dispose]();
        },
      };
    } catch (err) {
      chrome?.kill();
      userDataDir?.[Symbol.dispose]();
      dir[Symbol.dispose]();
      throw err;
    }
  }

  async function connect(dir: ReturnType<typeof tempDir>, endpoint: string) {
    await using proc = Bun.spawn({
      cmd: [bunExe(), "connect.mjs", endpoint],
      env: bunEnv,
      cwd: String(dir),
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    if (exitCode !== 0) console.error(stderr);
    expect(stdout.trim()).toBe("TITLE cdp-ok");
    expect(exitCode).toBe(0);
  }

  test("connects with ws:// endpoint", async () => {
    using ctx = await setup();
    await connect(ctx.dir, ctx.wsEndpoint);
  });
});
