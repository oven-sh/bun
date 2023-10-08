import { ConsoleMessage, Page, launch } from "puppeteer";
import assert from "assert";
import { copyFileSync } from "fs";
import { join } from "path";

const root = join(import.meta.dir, "../");

copyFileSync(join(root, "src/Counter1.txt"), join(root, "src/Counter.tsx"));

let url = "http://localhost:3000";
if (process.argv.length > 2) {
  url = process.argv[2];
}

const b = await launch({
  headless: "new",
});

const p = await b.newPage();
// p.on("console", msg => console.log("[browser]", msg.text()));

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

await p.goto(url);
await waitForConsoleMessage(p, /counter a/);

assert.strictEqual(await p.$eval("code.font-bold", x => x.innerText), Bun.version);

let counter_root = (await p.$("#counter-fixture"))!;

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
