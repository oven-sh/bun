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

  // Track console messages to avoid race conditions.
  // Messages are collected as they arrive, and waitForConsoleMessage
  // checks both existing messages and listens for new ones.
  const consoleMessages: string[] = [];
  p.on("console", (msg: ConsoleMessage) => {
    consoleMessages.push(msg.text());
  });

  function waitForConsoleMessage(page: Page, regex: RegExp, startIndex = 0) {
    const { resolve, promise } = Promise.withResolvers<number>();
    let resolved = false;

    // Attach listener FIRST to avoid race condition
    function onMessage(msg: ConsoleMessage) {
      if (resolved) return;
      const text = msg.text();
      if (regex.test(text)) {
        resolved = true;
        page.off("console", onMessage);
        resolve(consoleMessages.length);
      }
    }
    page.on("console", onMessage);

    // Then check if we already have a matching message in the buffer
    for (let i = startIndex; i < consoleMessages.length; i++) {
      if (regex.test(consoleMessages[i])) {
        resolved = true;
        page.off("console", onMessage);
        resolve(i + 1);
        break;
      }
    }

    return promise;
  }

  await p.goto(url, { waitUntil: "load" });
  const afterInitialLoad = await waitForConsoleMessage(p, /counter a/);

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

  await p.reload({ waitUntil: "networkidle0" });
  const afterReload = await waitForConsoleMessage(p, /counter a/, afterInitialLoad);

  assert.strictEqual(await p.$eval("code.font-bold", x => x.innerText), Bun.version);

  // Wait for counter fixture to be available and visible after reload
  await p.waitForSelector("#counter-fixture", { visible: true });
  counter_root = (await p.$("#counter-fixture"))!;

  assert.strictEqual(await getCount(), "Count A: 0");
  await counter_root.$eval(".inc", x => (x as HTMLElement).click());
  assert.strictEqual(await getCount(), "Count A: 1");
  await counter_root.$eval(".inc", x => (x as HTMLElement).click());
  assert.strictEqual(await getCount(), "Count A: 2");
  await counter_root.$eval(".dec", x => (x as HTMLElement).click());
  assert.strictEqual(await getCount(), "Count A: 1");

  copyFileSync(join(root, "src/Counter2.txt"), join(root, "src/Counter.tsx"));
  await waitForConsoleMessage(p, /counter b loaded/, afterReload);
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
