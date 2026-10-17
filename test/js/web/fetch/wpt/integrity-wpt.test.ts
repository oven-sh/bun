// Runs the vendored Web Platform Tests fetch/api/basic/integrity.sub.any.js
// against Bun's fetch(). The .any.js file is byte-identical to upstream; this
// driver follows the test/js/third_party/wpt-h2 pattern and stands in for
// wptserve: it serves the one resource that the file fetches and fills in the
// `{{host}}` and `{{ports[...]}}` substitutions of a `.sub.` file.
//
// Vendored from web-platform-tests/wpt:
//   fetch/api/basic/integrity.sub.any.js

import { afterAll, test as bunTest } from "bun:test";
import { tls } from "harness";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { setRegistrar, wptTest } from "../../../third_party/wpt-testharness-shim";

// WPT subtests that do not pass on the current implementation. Tests whose
// names appear here are registered via test.todo so the suite stays green
// while still surfacing the gap.
const knownFailures = new Set<string>([
  // Bun's fetch() has no `mode: "no-cors"`, so it has no opaque responses.
  "Empty string integrity for opaque response",
  "SHA-* integrity for opaque response",
]);

setRegistrar((name, run) => {
  if (knownFailures.has(name)) {
    bunTest.todo(name);
    return;
  }
  bunTest(name, run);
});

// fetch/api/resources/top.txt, with the `?pipe=header(Access-Control-Allow-Origin,*)` of the cross-origin URL.
const serveTop = (request: Request) =>
  new URL(request.url).pathname === "/fetch/api/resources/top.txt"
    ? new Response("top", { headers: { "Content-Type": "text/plain", "Access-Control-Allow-Origin": "*" } })
    : new Response("not found", { status: 404 });

const sameOrigin = Bun.serve({ port: 0, fetch: serveTop });
const crossOrigin = Bun.serve({ port: 0, fetch: serveTop });
const secure = Bun.serve({ port: 0, tls, fetch: serveTop });
afterAll(() => Promise.all([sameOrigin.stop(true), crossOrigin.stop(true), secure.stop(true)]));

// The file fetches a URL that is relative to its own location.
const location = new URL(`http://127.0.0.1:${sameOrigin.port}/fetch/api/basic/integrity.sub.any.js`);
const fetchFromLocation = (input: string, init?: RequestInit) =>
  fetch(new URL(input, location).href, { ...init, tls: { rejectUnauthorized: false } } as RequestInit);

const src = readFileSync(join(import.meta.dir, "integrity.sub.any.js"), "utf8")
  .replaceAll("{{host}}", "127.0.0.1")
  .replaceAll("{{ports[http][1]}}", String(crossOrigin.port))
  .replaceAll("{{ports[https][0]}}", String(secure.port));

// bun:test injects its own `test` binding into every imported module, which
// would shadow the WPT-style test(fn, name) global. Run the file inside a
// Function whose parameters are the shim's `test`, the globals that wptserve
// and fetch/api/resources/utils.js give it, and a fetch() that resolves
// relative URLs. All other testharness identifiers resolve via globalThis.
new Function("test", "fetch", "location", "RESOURCES_DIR", "dirname", "done", src)(
  wptTest,
  fetchFromLocation,
  location,
  "../resources/",
  (path: string) => path.replace(/\/[^\/]*$/, "/"),
  () => {},
);
