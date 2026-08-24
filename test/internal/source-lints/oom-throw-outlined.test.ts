import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import path from "node:path";

// Every Rust host function thunk converts its body's `JsResult` through
// `to_js_host_call` (src/jsc/host_fn.rs), which is generic over the body, so
// its `Err(JsError::OutOfMemory) => global.throw_out_of_memory_value()` arm is
// instantiated once per thunk (about 1,170 of them). Under the cross-language
// LTO the release builds use, the C++ body behind that call
// (`JSGlobalObject__throwOutOfMemoryError`: throw scope, error object, throw)
// gets inlined into each instantiation unless the Rust helper is kept out of
// line: about 130 bytes per thunk, roughly 100 KB of binary, for a path that
// only runs when an allocation fails. A local build has no cross-language LTO,
// so dropping the attributes changes nothing anyone can see locally, and the
// CI size check only fails on jumps of 0.5 MB or more.
const FILE = "src/jsc/JSGlobalObject.rs";
const REQUIRED = ["#[cold]", "#[inline(never)]"];
const FUNCTIONS = ["throw_out_of_memory", "throw_out_of_memory_value"];

function attributesOf(lines: string[], fnIndex: number): string[] {
  const attributes: string[] = [];
  for (let i = fnIndex - 1; i >= 0; i--) {
    const line = lines[i].trim();
    if (line.startsWith("//")) continue;
    if (!line.startsWith("#[")) break;
    for (const [attribute] of line.matchAll(/#\[[^\]]*\]/g)) {
      attributes.push(attribute.replace(/\s+/g, ""));
    }
  }
  return attributes;
}

test("the out of memory throw helpers every host fn thunk instantiates stay out of line", () => {
  const lines = readFileSync(path.resolve(import.meta.dir, "..", "..", "..", FILE), "utf8").split("\n");

  const missing: Record<string, string[]> = {};
  for (const name of FUNCTIONS) {
    const definition = new RegExp(`^\\s*pub fn ${name}\\(`);
    const fnIndex = lines.findIndex(line => definition.test(line));
    if (fnIndex === -1) {
      missing[name] = [`pub fn ${name} not found in ${FILE}`];
      continue;
    }
    const attributes = attributesOf(lines, fnIndex);
    const absent = REQUIRED.filter(attribute => !attributes.includes(attribute));
    if (absent.length > 0) missing[name] = absent;
  }

  expect(missing).toEqual({});
});
