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
import { format_value, setRegistrar, wptTest } from "../../../../third_party/wpt-testharness-shim";

const ROOT = import.meta.dir;
const dataURLs: [input: string, mimeType: string | null, body?: number[]][] = JSON.parse(
  readFileSync(join(ROOT, "resources/data-urls.json"), "utf8"),
);

// processing.any.js subtests that do not pass yet: every row that expects a
// response. fetch() decodes the right body for them, but the subtest then
// reads `Content-Type` after the body is consumed (fetch() fills it lazily
// from the body Blob, which is gone by then) and expects the MIME type parsed
// and serialized per mimesniff, which fetch() does not do. `data://test:test/,X`
// must reject, which needs the input run through the URL parser first. These
// are registered with test.failing: the body still runs, and a subtest that
// starts passing fails the run until it is removed here. The body bytes of
// these rows are enforced separately at the bottom of this file.
const knownFailures = new Set<string>(
  dataURLs
    .filter(([input, mimeType]) => mimeType !== null || input === "data://test:test/,X")
    .map(([input]) => `processing.any.js :: ${format_value(input)}`),
);

// The .any.js files load their case tables with fetch("resources/*.json"),
// which the WPT server resolves against the test's URL. Serve those from
// disk; every other fetch (the data: URLs under test) is the real one.
const localFetch = (input: unknown, init?: RequestInit) =>
  typeof input === "string" && input.startsWith("resources/")
    ? Promise.resolve(new Response(Bun.file(join(ROOT, input))))
    : fetch(input as any, init);

let registered = 0;
const hits = new Set<string>();
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
    const key = `${file} :: ${name}`;
    if (knownFailures.has(key)) {
      hits.add(key);
      bunTest.failing(key, run);
      return;
    }
    bunTest(key, run);
  });
  // bun:test injects its own `test` binding into every module, which would
  // shadow the WPT test(fn, name) global, so load the vendored file as text.
  new Function("test", "fetch", readFileSync(join(ROOT, file), "utf8"))(wptTest, localFetch);
  await Promise.all(setups);
}

bunTest("every vendored subtest is registered and every known failure exists", () => {
  expect(registered).toBe(80 + 72);
  expect([...knownFailures].filter(key => !hits.has(key))).toEqual([]);
});

// Body bytes of the rows in knownFailures. `data:,X#X` is left out: excluding
// the fragment also needs the URL parser step, not only the decoder.
for (const [input, mimeType, body] of dataURLs) {
  if (mimeType === null || input === "data:,X#X") continue;
  bunTest(`body of ${format_value(input)}`, async () => {
    const res = await fetch(input);
    expect([...new Uint8Array(await res.arrayBuffer())]).toEqual(body!);
  });
}
