// Runs the vendored Web Platform Tests encoding/streams/backpressure.any.js
// against Bun's TextEncoderStream and TextDecoderStream. The .any.js file is
// byte-identical to upstream; this driver follows
// test/js/web/fetch/wpt/textstream-wpt.test.ts.
//
// Vendored from web-platform-tests/wpt @ 91d0bab137ca9fa3c5f5397c332834435430b4f5:
//   encoding/streams/backpressure.any.js

import { test as bunTest } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { setRegistrar, wptTest } from "../../../third_party/wpt-testharness-shim";

setRegistrar((name, run) => {
  bunTest(name, run);
});

// bun:test injects its own `test` binding into every imported module, which
// would shadow the WPT-style test(fn, name) global. Load the vendored file
// as text and run it inside a Function whose `test` parameter is the shim.
// All other testharness identifiers resolve via globalThis.
const src = readFileSync(join(import.meta.dir, "backpressure.any.js"), "utf8");
new Function("test", src)(wptTest);
