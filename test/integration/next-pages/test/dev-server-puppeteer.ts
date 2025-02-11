import assert from "assert";
import { copyFileSync } from "fs";
import { join } from "path";
import type { ConsoleMessage, Page } from "puppeteer";
import { launch } from "puppeteer";
import { which } from "bun";
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

const b = await launch({
  // On macOS, there are issues using the new headless mode.
  // "TargetCloseError: Protocol error (Target.setAutoAttach): Target closed"
  headless: process.platform === "darwin" ? "shell" : true,
  // Inherit the stdout and stderr of the browser process.
  dumpio: true,
  // Prefer to use a pipe to connect to the browser, instead of a WebSocket.
  pipe: true,
  // Disable timeouts.
  timeout: 0,
  protocolTimeout: 0,
  // Specify that chrome should be used, for consistent test results.
  // If a browser path is not found, it will be downloaded.
  browser: "chrome",
  executablePath: browserPath,
  args: [
    // On Linux, there are issues with the sandbox, so disable it.
    // On macOS, this fixes: "dock_plist is not an NSDictionary"
    "--no-sandbox",
    "--disable-setuid-sandbox",

    // On Docker, the default /dev/shm is too small for Chrome, which causes
    // crashes when rendering large pages, so disable it.
    "--disable-dev-shm-usage",

    // Fixes: "Navigating frame was detached"
    "--disable-features=site-per-process",
  ],
});

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
  p.goto(url);
  await console_promise;

  console.error("Loaded page");
  assert.strictEqual(await p.$eval("code.font-bold", x => x.innerText), Bun.version);

  let counter_root = (await p.$("#counter-fixture"))!;
  console.error("Loaded counter");
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

  p.reload({});
  await waitForConsoleMessage(p, /counter a/);

  assert.strictEqual(await p.$eval("code.font-bold", x => x.innerText), Bun.version);

  counter_root = (await p.$("#counter-fixture"))!;

  assert.strictEqual(await getCount(), "Count A: 0");
  await counter_root.$eval(".inc", x => (x as HTMLElement).click());
  assert.strictEqual(await getCount(), "Count A: 1");
  await counter_root.$eval(".inc", x => (x as HTMLElement).click());
  assert.strictEqual(await getCount(), "Count A: 2");
  await counter_root.$eval(".dec", x => (x as HTMLElement).click());
  assert.strictEqual(await getCount(), "Count A: 1");

  copyFileSync(join(root, "src/Counter2.txt"), join(root, "src/Counter.tsx"));
  await waitForConsoleMessage(p, /counter b loaded/);
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
