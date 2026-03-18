import assert from "assert";
import { which } from "bun";
import { copyFileSync } from "fs";
import { join } from "path";
import type { ConsoleMessage, Page } from "puppeteer";
import { launch } from "puppeteer";
const root = join(import.meta.dir, "../");

copyFileSync(join(root, "src/Counter1.txt"), join(root, "src/Counter.tsx"));

let url = "http://localhost:3000";
if (process.argv.length > 2) {
  url = process.argv[2];
}

const browserPath = which("chromium-browser") || which("chromium") || which("chrome") || undefined;
if (!browserPath) {
  console.warn("Since a Chromium browser was not found, it will be downloaded by Puppeteer.");
}

// On macOS CI, Chrome for Testing sometimes fails to launch because
// macOS quarantines downloaded binaries. Remove the quarantine attribute
// from all binaries, and also ensure they are executable.
if (process.platform === "darwin") {
  try {
    const { execSync } = require("child_process");
    const cachePath = join(process.env.HOME || "~", ".cache", "puppeteer");
    // Remove quarantine from the entire puppeteer cache
    execSync(`xattr -rd com.apple.quarantine "${cachePath}" 2>/dev/null || true`, { stdio: "ignore" });
    // Also ensure all chrome/chromium binaries in the cache are executable
    execSync(`find "${cachePath}" -type f -name "Google Chrome for Testing" -exec chmod +x {} + 2>/dev/null || true`, { stdio: "ignore" });
    execSync(`find "${cachePath}" -type f -name "chrome-headless-shell" -exec chmod +x {} + 2>/dev/null || true`, { stdio: "ignore" });
    execSync(`find "${cachePath}" -type f -name "chrome" -exec chmod +x {} + 2>/dev/null || true`, { stdio: "ignore" });
  } catch {}
}

const isMacOS = process.platform === "darwin";
const launchOptions: Parameters<typeof launch>[0] = {
  // Use "shell" mode on macOS — it uses chrome-headless-shell which is a
  // standalone binary that avoids macOS Gatekeeper issues that block the
  // full Chrome for Testing .app bundle from launching.
  headless: isMacOS ? "shell" : true,
  dumpio: true,
  // On macOS, pipe mode causes TargetCloseError during browser launch.
  pipe: !isMacOS,
  timeout: 30_000,
  protocolTimeout: 60_000,
  browser: "chrome",
  // On macOS with "shell" mode, don't pass a system browser path — it would
  // point to full Chrome, not chrome-headless-shell. On other platforms,
  // use the system browser if found.
  ...(!isMacOS && browserPath ? { executablePath: browserPath } : {}),
  args: [
    "--no-sandbox",
    "--disable-setuid-sandbox",
    "--disable-dev-shm-usage",
    "--disable-features=site-per-process",
    "--disable-gpu",
    "--disable-software-rasterizer",
  ],
};

// Retry browser launch up to 3 times — Chrome intermittently fails to start
// on macOS CI with "Failed to launch the browser process!"
let b;
for (let attempt = 1; attempt <= 3; attempt++) {
  try {
    b = await launch(launchOptions);
    break;
  } catch (e: any) {
    console.error(`Browser launch attempt ${attempt}/3 failed: ${e?.message || e}`);
    if (attempt === 3) throw e;
    // Give more time between retries (3s) for transient macOS launch issues
    await new Promise(r => setTimeout(r, 3000));
  }
}

process.on("beforeExit", async reason => {
  await b?.close?.();
});

process.once("SIGTERM", () => {
  b?.close?.();
  setTimeout(() => {
    process.exit(0);
  }, 100);
});

async function main() {
  const p = await b.newPage();
  console.error("Loaded puppeteer");

  function waitForConsoleMessage(page: Page, regex: RegExp) {
    const { resolve, promise } = Promise.withResolvers<void>();
    function onMessage(msg: ConsoleMessage) {
      const text = msg.text();
      if (regex.test(text)) {
        page.off("console", onMessage);
        resolve();
      }
    }
    p.on("console", onMessage);
    return promise;
  }

  const console_promise = waitForConsoleMessage(p, /counter a/);
  await Promise.all([p.goto(url), console_promise]);

  console.error("Loaded page");
  assert.strictEqual(await p.$eval("code.font-bold", x => x.innerText), Bun.version);

  let counter_root = (await p.$("#counter-fixture"))!;
  console.error("Loaded counter");

  // Wait for Tailwind CSS to be applied before checking computed styles.
  // On slow CI machines, stylesheets may not be loaded when the page first renders.
  await p.waitForFunction(() => {
    const el = document.querySelector("#counter-fixture");
    return el && getComputedStyle(el).borderBottomLeftRadius === "9999px";
  });

  {
    const [has_class, style_json_string] = await counter_root.evaluate(
      x => [(x as HTMLElement).classList.contains("rounded-bl-full"), JSON.stringify(getComputedStyle(x))] as const,
    );
    assert.strictEqual(has_class, true);
    const decoded_style = JSON.parse(style_json_string);
    assert.strictEqual(decoded_style.borderTopLeftRadius, "0px");
    assert.strictEqual(decoded_style.borderTopRightRadius, "0px");
    assert.strictEqual(decoded_style.borderBottomRightRadius, "0px");
    assert.strictEqual(decoded_style.borderBottomLeftRadius, "9999px");
  }

  const getCount = () => counter_root.$eval("p", x => x.innerText);

  assert.strictEqual(await getCount(), "Count A: 0");
  await counter_root.$eval(".inc", x => (x as HTMLElement).click());
  assert.strictEqual(await getCount(), "Count A: 1");
  await counter_root.$eval(".inc", x => (x as HTMLElement).click());
  assert.strictEqual(await getCount(), "Count A: 2");
  await counter_root.$eval(".dec", x => (x as HTMLElement).click());
  assert.strictEqual(await getCount(), "Count A: 1");

  // Set up the console listener BEFORE triggering reload to avoid a race
  // where the page reloads and fires the message before the listener is attached.
  const reload_promise = waitForConsoleMessage(p, /counter a/);
  await Promise.all([p.reload({}), reload_promise]);

  assert.strictEqual(await p.$eval("code.font-bold", x => x.innerText), Bun.version);

  counter_root = (await p.$("#counter-fixture"))!;

  assert.strictEqual(await getCount(), "Count A: 0");
  await counter_root.$eval(".inc", x => (x as HTMLElement).click());
  assert.strictEqual(await getCount(), "Count A: 1");
  await counter_root.$eval(".inc", x => (x as HTMLElement).click());
  assert.strictEqual(await getCount(), "Count A: 2");
  await counter_root.$eval(".dec", x => (x as HTMLElement).click());
  assert.strictEqual(await getCount(), "Count A: 1");

  // Set up listener BEFORE triggering HMR to avoid missing the message.
  const hmr_promise = waitForConsoleMessage(p, /counter b loaded/);
  copyFileSync(join(root, "src/Counter2.txt"), join(root, "src/Counter.tsx"));
  await hmr_promise;

  // After HMR, the DOM is rebuilt — wait for it to reflect the new component
  // and re-query the element handle since the old one may be stale.
  await p.waitForFunction(() => {
    const el = document.querySelector("#counter-fixture p");
    return el && el.textContent?.startsWith("Count B:");
  });
  counter_root = (await p.$("#counter-fixture"))!;

  assert.strictEqual(await getCount(), "Count B: 1");
  await counter_root.$eval(".inc", x => (x as HTMLElement).click());
  assert.strictEqual(await getCount(), "Count B: 3");
  await counter_root.$eval(".inc", x => (x as HTMLElement).click());
  assert.strictEqual(await getCount(), "Count B: 5");
  await counter_root.$eval(".dec", x => (x as HTMLElement).click());
  assert.strictEqual(await getCount(), "Count B: 3");

  {
    const [has_class, style_json_string] = await counter_root.evaluate(
      x => [(x as HTMLElement).classList.contains("rounded-br-full"), JSON.stringify(getComputedStyle(x))] as const,
    );
    assert.strictEqual(has_class, true);
    const decoded_style = JSON.parse(style_json_string);
    assert.strictEqual(decoded_style.borderTopLeftRadius, "0px");
    assert.strictEqual(decoded_style.borderTopRightRadius, "0px");
    assert.strictEqual(decoded_style.borderBottomRightRadius, "9999px");
    assert.strictEqual(decoded_style.borderBottomLeftRadius, "0px");
  }

  await b.close();
  console.error("Finished dev-server-puppeteer.ts");
}

try {
  await main();
} finally {
  await b?.close?.();
}
