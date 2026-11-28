// Execute a single vendored mjsunit test file in a fresh process, in sloppy
// (non-module) script mode with the assertion shim installed as globals --
// matching how V8's own d8 harness runs these files. Used by both the node
// runner and the bun test:
//
//   node one-file.mjs mjsunit/regexp-captures.js
//   bun  one-file.mjs mjsunit/regexp-captures.js

import { readFileSync } from "node:fs";
import { installMjsUnitGlobals } from "./mjsunit-shim.mjs";

const file = process.argv[2];
if (!file) {
  console.error("usage: one-file.mjs <test-file>");
  process.exit(2);
}

installMjsUnitGlobals(globalThis);
const source = readFileSync(file, "utf8");
// Indirect eval: global scope, sloppy mode (script semantics).
(0, eval)(source);
console.log("ok");
