// Runs the vendored Web Platform Tests fetch/api/body/textstream.any.js
// against Bun's Body.textStream() implementation. The .any.js file is
// byte-identical to upstream; this driver follows the
// test/js/third_party/wpt-h2 pattern.
//
// Vendored from web-platform-tests/wpt:
//   fetch/api/body/textstream.any.js

import { test as bunTest } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { setRegistrar, wptTest } from "../../../third_party/wpt-testharness-shim";

// WPT subtests that do not pass on the current implementation. Tests whose
// names appear here are registered via test.todo so the suite stays green
// while still surfacing the gap.
const knownFailures = new Set<string>([]);

setRegistrar((name, run) => {
  if (knownFailures.has(name)) {
    bunTest.todo(name);
    return;
  }
  bunTest(name, run);
});

// bun:test injects its own `test` binding into every imported module, which
// would shadow the WPT-style test(fn, name) global. Load the vendored file
// as text and run it inside a Function whose `test` parameter is the shim.
// All other testharness identifiers resolve via globalThis.
const src = readFileSync(join(import.meta.dir, "textstream.any.js"), "utf8");
new Function("test", src)(wptTest);
