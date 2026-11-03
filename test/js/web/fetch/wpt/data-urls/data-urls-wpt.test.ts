// Runs the vendored Web Platform Tests fetch/data-urls suite against fetch():
//   base64.any.js      resources/base64.json     forgiving-base64 body decode
//   processing.any.js  resources/data-urls.json  the data: URL processor
// The four files are byte-identical to upstream; this driver follows the
// test/js/web/fetch/wpt/textstream-wpt.test.ts pattern.
//
// Vendored from web-platform-tests/wpt @ 8fa79675278b21028654626c94dd7220f0f817a6:
//   fetch/data-urls/base64.any.js
//   fetch/data-urls/processing.any.js
//   fetch/data-urls/resources/base64.json
//   fetch/data-urls/resources/data-urls.json

import { test as bunTest, expect } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { setRegistrar, wptTest } from "../../../../third_party/wpt-testharness-shim";

const ROOT = import.meta.dir;

// The .any.js files load their case tables with fetch("resources/*.json"),
// which the WPT server resolves against the test's URL. Serve those from
// disk; every other fetch (the data: URLs under test) is the real one.
const localFetch = (input: unknown, init?: RequestInit) =>
  typeof input === "string" && input.startsWith("resources/")
    ? Promise.resolve(new Response(Bun.file(join(ROOT, input))))
    : fetch(input as any, init);

let registered = 0;
for (const file of ["base64.any.js", "processing.any.js"]) {
  // Each file's "Setup." promise_test fetches the JSON and registers one
  // promise_test per row from inside its body. bun:test cannot register
  // tests once the run has started, so run Setup here (top-level await) and
  // map every row it registers onto bun:test.
  const setups: Promise<void>[] = [];
  setRegistrar((name, run) => {
    if (name === "Setup.") {
      setups.push(run());
      return;
    }
    registered++;
    bunTest(`${file} :: ${name}`, run);
  });
  // bun:test injects its own `test` binding into every module, which would
  // shadow the WPT test(fn, name) global, so load the vendored file as text.
  new Function("test", "fetch", readFileSync(join(ROOT, file), "utf8"))(wptTest, localFetch);
  await Promise.all(setups);
}

bunTest("every vendored subtest is registered", () => {
  expect(registered).toBe(80 + 72);
});
