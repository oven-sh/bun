import { Glob } from "bun";
import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import path from "node:path";

// `Bake::GlobalObject` (src/runtime/bake/BakeGlobalObject.h) only exists in a
// `bun build --app` production build; the dev server runs in the ordinary
// runtime VM, whose global is a plain `Zig::GlobalObject`. Rust binds every bake
// entry point as `&JSGlobalObject`, so an `extern "C"` parameter typed
// `GlobalObject*` (`Bake::GlobalObject*` inside `namespace Bake`) is a claim
// about the caller that nothing checks: `BakeLoadServerHmrPatch` was declared
// that way while only ever being called by the dev server.
//
// The idiom in these files is to take `JSC::JSGlobalObject*` and
// `uncheckedDowncast<Bake::GlobalObject>` inside the functions that need the
// production-only fields (`BakeGlobalObject__getPerThreadData`), which asserts
// the claim in debug builds. This lint keeps the signatures on that idiom.
//
// Recognized shape: one `extern "C" <ret> Name(...)` declaration or definition
// per function, which is how every entry point in src/runtime/bake/ is written.

const root = path.resolve(import.meta.dir, "..", "..", "..");
const bakeDir = "src/runtime/bake";

const EXTERN_C_FUNCTION = /extern\s+"C"\s+[^;{}()]*?\b(\w+)\s*\(/g;
// `GlobalObject*`, `Bake::GlobalObject*` or `::Bake::GlobalObject*` (also by
// reference). The lookbehind rejects `JSC::JSGlobalObject*` and
// `Zig::GlobalObject*`, which every global satisfies.
const BAKE_GLOBAL_PARAM = /(?<![\w:])(?:(?:::)?Bake::)?GlobalObject\s*(?:const\s*)?[*&]/;

function stripLineComments(source: string): string {
  // `[ \t]*`, not `\s*`, so blank lines survive and line numbers stay right.
  return source.replace(/^[ \t]*\/\/.*$/gm, "");
}

let externCFunctions = 0;
const offenders: string[] = [];
for (const rel of new Glob("*.{cpp,h}").scanSync({ cwd: path.join(root, bakeDir) })) {
  const file = path.posix.join(bakeDir, rel.replaceAll(path.sep, "/"));
  const source = stripLineComments(readFileSync(path.join(root, file), "utf8"));
  for (const m of source.matchAll(EXTERN_C_FUNCTION)) {
    externCFunctions++;
    const paramsStart = m.index + m[0].length;
    let depth = 1;
    let i = paramsStart;
    for (; i < source.length && depth > 0; i++) {
      if (source[i] === "(") depth++;
      else if (source[i] === ")") depth--;
    }
    if (!BAKE_GLOBAL_PARAM.test(source.slice(paramsStart, i - 1))) continue;
    const line = source.slice(0, m.index).split("\n").length;
    offenders.push(`${file}:${line}: ${m[1]}`);
  }
}
offenders.sort();

test('the pattern still recognizes the bake extern "C" entry points', () => {
  // Guards against the ban below passing because the declarations changed
  // shape (or the directory moved) and nothing was scanned.
  expect(externCFunctions).toBeGreaterThan(0);
});

test('bake extern "C" entry points take JSC::JSGlobalObject*, not Bake::GlobalObject*', () => {
  expect(offenders).toEqual([]);
});
