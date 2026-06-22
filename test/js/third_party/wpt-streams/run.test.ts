// Runs the vendored WPT streams/transform-streams .any.js suite against Bun's
// TransformStream. The .any.js files and resources/ helpers are byte-identical
// to upstream; this driver supplies the testharness globals.
//
// Vendored from web-platform-tests/wpt @ e4a4672e9e607fc2b28e7173b83ce4e38ef53071
//   streams/transform-streams/*.any.js
//   streams/resources/{test-utils,recording-streams,rs-utils}.js
//
// To update: re-download the files above at a newer wpt commit and refresh the
// SHA. Tests Bun does not yet pass are listed in known-failures.ts and run as
// test.todo so the suite stays green while documenting each gap.

import { describe } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { wptTest } from "./testharness-shim";
import "./known-failures";

function load(file: string) {
  return readFileSync(join(import.meta.dir, file), "utf8");
}

// Resource scripts the .any.js files reference via META: script= directives.
// They install helpers on `self`, which the shim aliases to globalThis.
const resources = ["test-utils.js", "recording-streams.js", "rs-utils.js"].map(load).join("\n;\n");

const files = [
  "backpressure.any.js",
  "cancel.any.js",
  "errors.any.js",
  "flush.any.js",
  "general.any.js",
  "lipfuzz.any.js",
  "patched-global.any.js",
  "properties.any.js",
  "reentrant-strategies.any.js",
  "strategies.any.js",
  "terminate.any.js",
];

// bun:test injects its own `test` binding into every imported module, which
// would shadow the WPT-style test(fn, name) global. Load each vendored file
// as text and run it inside a Function whose `test` parameter is the shim.
for (const file of files) {
  describe(file, () => {
    new Function("test", resources + "\n;\n" + load(file))(wptTest);
  });
}
