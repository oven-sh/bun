import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import path from "node:path";

// bun_libuv_sys (src/libuv_sys/) is `#![cfg(windows)]`, and so is every use of
// it in the rest of the tree. On the posix build and check lanes rustc never
// resolves those paths, so a declaration deleted from the crate while a
// cfg(windows) caller still names it (or a caller added for a declaration that
// is already gone) is only found by the Windows build, ~25 minutes in. This
// happened when #37332 dropped `uv_translate_sys_error` / `uv_os_getppid` and
// #31829, merged in between, had started calling both.
//
// This lint resolves the crate-root names textually on any host: every name
// reached through the crate from src/ must be an item the crate defines or
// re-exports. Only root names are checked; methods, fields and signatures
// remain rustc's job on Windows (`bun run rust:check-all`).
//
// Comments are handled per match (a hit preceded by `//` on its line is
// skipped) rather than by stripping them up front: a `/*` inside a `//` comment
// (`build/*/codegen`) would otherwise swallow real code up to the next `*/`.

const root = path.resolve(import.meta.dir, "..", "..", "..");

function rustFiles(pattern: string): string[] {
  return [...new Bun.Glob(pattern).scanSync({ cwd: root })].map(p => p.replaceAll("\\", "/")).sort();
}

function inLineComment(code: string, offset: number): boolean {
  return code.slice(code.lastIndexOf("\n", offset) + 1, offset).includes("//");
}

function lineOf(code: string, offset: number): number {
  return code.slice(0, offset).split("\n").length;
}

// Names a path into the crate can resolve to. Deliberately a superset of the
// real crate root (impl methods and items of nested modules are collected too,
// and every identifier of a `pub use` line counts): a name missing from this
// set is missing everywhere, and that is the only thing this lint reports.
function crateNames(): Set<string> {
  const names = new Set<string>();
  const item =
    /\b(?:fn|struct|enum|union|type|mod|trait|macro_rules!)\s+([A-Za-z_]\w*)|\b(?:const|static)\s+(?:mut\s+)?(?!fn\b)([A-Za-z_]\w*)/g;
  for (const file of rustFiles("src/libuv_sys/**/*.rs")) {
    const code = readFileSync(path.join(root, file), "utf8");
    for (const m of code.matchAll(item)) {
      if (!inLineComment(code, m.index)) names.add(m[1] ?? m[2]);
    }
    for (const m of code.matchAll(/^\s*pub(?:\([^)]*\))?\s+use\b([^;]*);/gm)) {
      for (const id of m[1].matchAll(/[A-Za-z_]\w*/g)) names.add(id[0]);
    }
  }
  return names;
}

// The crate is reached by name, through bun_sys's re-export
// (`pub use bun_libuv_sys as libuv;` in src/sys/windows/mod.rs, spelled out as
// `bun_sys::windows::libuv::Loop` or `crate::windows::libuv::ReturnCode`), or
// through the tree-wide aliases `use bun_libuv_sys as uv;` /
// `use bun_sys::windows::libuv as uv;` / `use bun_sys::windows::libuv;`.
const DIRECT = "bun_libuv_sys|windows::libuv";
const WITH_ALIASES = `${DIRECT}|libuv|uv`;
// The bare aliases are only followed in files with a `use` declaration naming
// the crate or the re-export, so a file that binds `uv::` / `libuv::` to
// something else is left alone (bun_core, which bun_libuv_sys depends on,
// declares its own one-function `windows_sys::libuv` module).
const importsCrate = /^\s*(?:pub(?:\([^)]*\))?\s+)?use\b[^;]*\b(?:bun_libuv_sys|libuv)\b/m;

function pathRefs(prefixes: string): RegExp {
  return new RegExp(String.raw`(?<!\w)(?:${prefixes})::([A-Za-z_]\w*)`, "g");
}
// `use bun_sys::windows::libuv::{a, b as _, c::{d}};` is not a path reference;
// each entry's leading segment is a root name (one level of nesting allowed).
function useListRefs(prefixes: string): RegExp {
  return new RegExp(String.raw`\buse\s+(?:\w+::)*(?:${prefixes})::\{((?:[^{}]|\{[^{}]*\})*)\}`, "g");
}

test("every name referenced through bun_libuv_sys exists in src/libuv_sys", () => {
  const names = crateNames();
  const missing: string[] = [];
  let referenced = 0;

  for (const file of rustFiles("src/**/*.rs")) {
    if (file.startsWith("src/libuv_sys/")) continue;
    const bytes = readFileSync(path.join(root, file));
    if (!bytes.includes("uv::") && !bytes.includes("bun_libuv_sys")) continue;
    const code = bytes.toString("utf8");
    const prefixes = importsCrate.test(code) ? WITH_ALIASES : DIRECT;

    for (const m of code.matchAll(pathRefs(prefixes))) {
      if (inLineComment(code, m.index)) continue;
      referenced++;
      if (!names.has(m[1])) missing.push(`${file}:${lineOf(code, m.index)}: ${m[0]}`);
    }
    for (const m of code.matchAll(useListRefs(prefixes))) {
      if (inLineComment(code, m.index)) continue;
      for (const entry of m[1].replace(/\{[^{}]*\}/g, "").split(",")) {
        const name = /^\s*([A-Za-z_]\w*)/.exec(entry)?.[1];
        if (name === undefined || name === "self") continue;
        referenced++;
        if (!names.has(name)) missing.push(`${file}:${lineOf(code, m.index)}: use ...::{${name}}`);
      }
    }
  }

  expect(missing).toEqual([]);
  // Several hundred references exist today; if a change to the crate's layout
  // or to these regexes stopped finding them, the lint would pass vacuously.
  expect(referenced).toBeGreaterThan(200);
});
