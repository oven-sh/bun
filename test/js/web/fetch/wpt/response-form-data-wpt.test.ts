// Runs the vendored Web Platform Test fetch/api/response/response-form-data.html
// against Response.formData(). The .html file is byte-identical to upstream;
// this driver follows textstream-wpt.test.ts.
//
// Vendored from web-platform-tests/wpt:
//   fetch/api/response/response-form-data.html

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

// The test is an HTML page whose one inline script holds every subtest. Run
// it the way the .any.js drivers run theirs: inside a Function whose `test`
// parameter is the shim, with the other testharness names on globalThis.
const html = readFileSync(join(import.meta.dir, "response-form-data.html"), "utf8");
const script = /<script>([\s\S]*?)<\/script>/.exec(html)![1];
new Function("test", script)(wptTest);
