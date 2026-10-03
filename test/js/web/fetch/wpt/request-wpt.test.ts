// Runs the vendored Web Platform Tests fetch/api/request/request-disturbed.any.js
// and request-init-stream.any.js against Bun's Request constructor. The
// .any.js files are byte-identical to upstream; this driver follows
// textstream-wpt.test.ts.
//
// Vendored from web-platform-tests/wpt:
//   fetch/api/request/request-disturbed.any.js   (9907f5871e78)
//   fetch/api/request/request-init-stream.any.js (86181156e33f)

import { test as bunTest, describe } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { setRegistrar, wptTest } from "../../../third_party/wpt-testharness-shim";

// WPT subtests that do not pass on the current implementation. Tests whose
// names appear here are registered via test.todo so the suite stays green
// while still surfacing the gap.
const knownFailures = new Set<string>([
  // Written for the Fetch text of 2020, where the constructor disturbed the
  // input even when init gave a body. The current text and Node leave the
  // input untouched in that case.
  "Input request used for creating new request became disturbed even if body is not used",
  // Needs the "GET/HEAD request cannot have a body" and forbidden-method
  // checks of the constructor.
  'Request construction failure should not set "bodyUsed"',
  // RequestInit.duplex is not validated.
  "It is error to omit .duplex when the body is a ReadableStream.",
  "It is error to set .duplex = 'full' when the body is null.",
  "It is error to set .duplex = 'full' when the body is a string.",
  "It is error to set .duplex = 'full' when the body is a Uint8Array.",
  "It is error to set .duplex = 'full' when the body is a Blob.",
  "It is error to set .duplex = 'full' when the body is a ReadableStream.",
]);

setRegistrar((name, run) => {
  if (knownFailures.has(name)) {
    bunTest.todo(name, run);
    return;
  }
  bunTest(name, run);
});

// The files build requests from relative URLs, which a document resolves
// against its base URL. Bun has no base URL, so the first argument is resolved
// here before it reaches the real constructor.
const RequestWithBase = new Proxy(Request, {
  construct(target, [input, ...rest]) {
    return new target(input instanceof target ? input : new URL(String(input), "http://example.com/").href, ...rest);
  },
});

// bun:test injects its own `test` binding into every imported module, which
// would shadow the WPT-style test(fn, name) global. Load each vendored file as
// text and run it inside a Function whose `test` parameter is the shim. All
// other testharness identifiers resolve via globalThis.
for (const file of ["request-disturbed.any.js", "request-init-stream.any.js"]) {
  describe(file, () => {
    const src = readFileSync(join(import.meta.dir, file), "utf8");
    new Function("test", "Request", src)(wptTest, RequestWithBase);
  });
}
