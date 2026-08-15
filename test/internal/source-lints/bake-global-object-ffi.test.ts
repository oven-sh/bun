import { Glob } from "bun";
import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import path from "node:path";

// `Bake::GlobalObject` (src/runtime/bake/BakeGlobalObject.h) is the global of a
// `bun build --app` production build: `BakeCreateProdGlobal` is the only thing
// that creates one, and it adds `m_perThreadData` on top of `Zig::GlobalObject`.
// The dev server runs inside the ordinary runtime VM, whose global is a plain
// `Zig::GlobalObject`.
//
// An `extern "C"` entry point in src/runtime/bake/ whose parameter is typed
// `GlobalObject*` (`Bake::GlobalObject*`, since these files sit in
// `namespace Bake`) therefore claims that every caller passes a production
// global. Nothing checks that claim at the boundary: the Rust bindings all spell
// the parameter `&JSGlobalObject`, so a dev-server caller compiles, and the C++
// body reads a `Zig::GlobalObject` as if it were the larger `Bake::GlobalObject`.
//
// Motivating instance: `BakeLoadServerHmrPatch` and
// `BakeLoadServerHmrPatchWithSourceMap` (src/runtime/bake/BakeSourceProvider.cpp)
// took `GlobalObject*` while their only callers were in
// src/runtime/bake/DevServer.rs. Entry points reachable from the dev server take
// `JSC::JSGlobalObject*`, like `BakeLoadInitialServerCode` next to them.
//
// The lint: every bake `extern "C"` function with a `Bake::GlobalObject*`
// parameter may only be bound (`fn Name(..)` in an extern block, `#[link_name]`,
// or a `HOST_EXPORT` marker) from the Rust files listed below, which are the
// ones whose global really is a production global. Recognized C++ shape: one
// `extern "C" <ret> Name(...)` declaration or definition per function, which is
// how every entry point in src/runtime/bake/ is written.

const root = path.resolve(import.meta.dir, "..", "..", "..");
const bakeDir = "src/runtime/bake";

const PRODUCTION_GLOBAL_RUST_FILES = new Set(["src/runtime/bake/production.rs"]);

const EXTERN_C_FUNCTION = /extern\s+"C"\s+[^;{}()]*?\b(\w+)\s*\(/g;
// `GlobalObject*`, `Bake::GlobalObject*` or `::Bake::GlobalObject*` (also by
// reference). The lookbehind rejects `JSC::JSGlobalObject*` and
// `Zig::GlobalObject*`, which every global satisfies.
const BAKE_GLOBAL_PARAM = /(?<![\w:])(?:(?:::)?Bake::)?GlobalObject\s*(?:const\s*)?[*&]/;

function stripLineComments(source: string): string {
  // `[ \t]*`, not `\s*`, so blank lines survive and line numbers stay right.
  return source.replace(/^[ \t]*\/\/.*$/gm, "");
}

function lineOf(source: string, index: number): number {
  return source.slice(0, index).split("\n").length;
}

function* readSources(dir: string, pattern: string): Generator<{ file: string; source: string }> {
  for (const rel of new Glob(pattern).scanSync({ cwd: path.join(root, dir) })) {
    const file = path.posix.join(dir, rel.replaceAll(path.sep, "/"));
    yield { file, source: stripLineComments(readFileSync(path.join(root, file), "utf8")) };
  }
}

// C++ function name -> where it is declared with a `Bake::GlobalObject*` parameter.
const declaredAt = new Map<string, string[]>();
let scannedCxx = 0;
for (const { file, source } of readSources(bakeDir, "*.{cpp,h}")) {
  scannedCxx++;
  for (const m of source.matchAll(EXTERN_C_FUNCTION)) {
    const paramsStart = m.index + m[0].length;
    let depth = 1;
    let i = paramsStart;
    for (; i < source.length && depth > 0; i++) {
      if (source[i] === "(") depth++;
      else if (source[i] === ")") depth--;
    }
    if (!BAKE_GLOBAL_PARAM.test(source.slice(paramsStart, i - 1))) continue;
    const name = m[1];
    declaredAt.set(name, [...(declaredAt.get(name) ?? []), `${file}:${lineOf(source, m.index)}`]);
  }
}

const names = [...declaredAt.keys()].sort();
const offenders: string[] = [];
const boundFromProduction: string[] = [];
if (names.length > 0) {
  const alternatives = names.join("|");
  const RUST_BINDING = new RegExp(
    String.raw`\bfn\s+(${alternatives})\s*\(|\blink_name\s*=\s*"(${alternatives})"|\bHOST_EXPORT\(\s*(${alternatives})\b`,
    "g",
  );
  for (const { file, source } of readSources("src", "**/*.rs")) {
    for (const m of source.matchAll(RUST_BINDING)) {
      const name = m[1] ?? m[2] ?? m[3];
      const entry = `${file}:${lineOf(source, m.index)}: ${name} (takes Bake::GlobalObject* at ${declaredAt.get(name)!.join(", ")})`;
      (PRODUCTION_GLOBAL_RUST_FILES.has(file) ? boundFromProduction : offenders).push(entry);
    }
  }
}
offenders.sort();

test("scans the bake C++ sources", () => {
  expect(scannedCxx).toBeGreaterThan(0);
});

test("the pattern still recognizes entry points that take Bake::GlobalObject*", () => {
  // If this goes empty, either the last such entry point was retyped (then
  // delete this lint) or the declarations no longer match EXTERN_C_FUNCTION.
  expect(names).not.toBeEmpty();
  // Same for the Rust side of the match: the production build binds these.
  expect(boundFromProduction).not.toBeEmpty();
});

test("entry points that take Bake::GlobalObject* are only bound by the production build", () => {
  expect(offenders).toEqual([]);
});
