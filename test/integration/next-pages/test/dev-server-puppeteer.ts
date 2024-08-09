import { ConsoleMessage, Page, launch } from "puppeteer";
import assert from "assert";
import { copyFileSync, readFileSync, writeFileSync } from "fs";
import { join } from "path";

const root = join(import.meta.dir, "../");

copyFileSync(join(root, "src/Counter1.txt"), join(root, "src/Counter.tsx"));

let url = "http://localhost:3000";
if (process.argv.length > 2) {
  url = process.argv[2];
}

const isWindows = process.platform === "win32";

const b = await launch({
  // While puppeteer is migrating to their new headless: `true` mode,
  // this causes strange issues on macOS in the cloud (AWS and MacStadium).
  //
  // There is a GitHub issue, but the discussion is unhelpful:
  // https://github.com/puppeteer/puppeteer/issues/10153
  //
  // Fixes: 'TargetCloseError: Protocol error (Target.setAutoAttach): Target closed'
  headless: "shell",
  dumpio: true,
  pipe: !isWindows,
  args: isWindows
    ? [
        // On windows, it seems passing these flags actually breaks stuff.
        "--no-sandbox",
      ]
    : [
        // Fixes: 'dock_plist is not an NSDictionary'
        "--no-sandbox",
        "--single-process",
        "--disable-setuid-sandbox",
        "--disable-dev-shm-usage",
        // Fixes: 'Navigating frame was detached'
        "--disable-features=site-per-process",
        // Uncomment if you want debug logs from Chromium:
        // "--enable-logging=stderr",
        // "--v=1",
      ],
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

  let console_promise = waitForConsoleMessage(p, /counter a/);
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
    console.error("looking at style");
    assert.strictEqual(has_class, true);
    const decoded_style = JSON.parse(style_json_string);
    assert.strictEqual(decoded_style.borderTopLeftRadius, "0px");
    assert.strictEqual(decoded_style.borderTopRightRadius, "0px");
    assert.strictEqual(decoded_style.borderBottomRightRadius, "0px");
    assert.strictEqual(decoded_style.borderBottomLeftRadius, "9999px");
  }

  const getCount = async () => {
    const count = await counter_root.$eval("p", x => x.innerText);
    console.error("Counter is at " + count);
    return count;
  };

  assert.strictEqual(await getCount(), "Count A: 0");
  await counter_root.$eval(".inc", x => (x as HTMLElement).click());
  assert.strictEqual(await getCount(), "Count A: 1");
  await counter_root.$eval(".inc", x => (x as HTMLElement).click());
  assert.strictEqual(await getCount(), "Count A: 2");
  await counter_root.$eval(".dec", x => (x as HTMLElement).click());
  assert.strictEqual(await getCount(), "Count A: 1");

  console.error("Waiting for A again");

  console_promise = waitForConsoleMessage(p, /counter a/);
  p.reload({});
  await console_promise;

  console.error("Continue");

  assert.strictEqual(await p.$eval("code.font-bold", x => x.innerText), Bun.version);

  counter_root = (await p.$("#counter-fixture"))!;

  assert.strictEqual(await getCount(), "Count A: 0");
  await counter_root.$eval(".inc", x => (x as HTMLElement).click());
  assert.strictEqual(await getCount(), "Count A: 1");
  await counter_root.$eval(".inc", x => (x as HTMLElement).click());
  assert.strictEqual(await getCount(), "Count A: 2");
  await counter_root.$eval(".dec", x => (x as HTMLElement).click());
  assert.strictEqual(await getCount(), "Count A: 1");

  writeFileSync(join(root, "src/Counter.tsx"), readFileSync(join(root, "src/Counter2.txt")));

  console.log("Waiting for Next HMR");
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
    console.log("Look at styles");
    assert.strictEqual(has_class, true);
    const decoded_style = JSON.parse(style_json_string);
    assert.strictEqual(decoded_style.borderTopLeftRadius, "0px");
    assert.strictEqual(decoded_style.borderTopRightRadius, "0px");
    assert.strictEqual(decoded_style.borderBottomRightRadius, "9999px");
    assert.strictEqual(decoded_style.borderBottomLeftRadius, "0px");
  }

  console.log("Closing");

  await b.close();
  console.error("Finished dev-server-puppeteer.ts");
}

try {
  await main();
} finally {
  await b?.close?.();
}
