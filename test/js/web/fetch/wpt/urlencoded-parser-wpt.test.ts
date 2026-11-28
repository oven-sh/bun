// Runs the vendored Web Platform Tests url/urlencoded-parser.any.js against
// Bun's application/x-www-form-urlencoded parser: URLSearchParams, and
// formData() of a Request and of a Response, on 35 inputs each. The .any.js
// file is byte-identical to upstream; this driver follows
// textstream-wpt.test.ts, without a list of known failures: every subtest
// has to pass.
//
// Vendored from web-platform-tests/wpt at b0099c748ba:
//   url/urlencoded-parser.any.js
//
// The upstream loops compare the entries they iterate and do not check the
// entry count. multipart/form-data bodies and Bun's other formData() entry
// points are covered in ../utf8-bom.test.ts.

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
const src = readFileSync(join(import.meta.dir, "urlencoded-parser.any.js"), "utf8");
new Function("test", src)(wptTest);
