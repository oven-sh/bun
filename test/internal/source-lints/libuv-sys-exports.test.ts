import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import path from "node:path";

// `bun_libuv_sys` (src/libuv_sys) is compiled on every target, but its whole
// surface (`libuv.rs`) is `#![cfg(windows)]`, and so is every use of it in the
// other crates. A non-Windows `cargo check` / `bun bd` therefore type-checks
// neither side: a declaration can be deleted from the crate while cfg(windows)
// code still calls it, and nothing notices until the Windows build-bun lanes
// fail (#37332 removed `uv_translate_sys_error` and `uv_os_getppid`, which
// `node_util_binding.rs`, `node_cluster_binding.rs` and `ipc_host.rs` call).
//
// This lint resolves every `bun_libuv_sys::<item>` path the rest of src/
// spells (directly, through `bun_sys::windows::libuv`, or through a `use ...
// as uv` alias of either) against the items the crate root exports, so the
// mismatch is reported on any host. `bun run rust:check-all` remains the
// complete check; this is the subset that runs in seconds without a Windows
// target installed.
//
// The scan runs at module scope, like the other whole-tree lints here, so the
// per-test timeout only covers the assertions.

const root = path.resolve(import.meta.dir, "..", "..", "..");

function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
}

/** Names in a `{a, b as c, d::{..}}` use-list, as `[name, alias]` pairs. */
function useListEntries(list: string): Array<[name: string, alias: string | undefined]> {
  const entries: Array<[string, string | undefined]> = [];
  for (const entry of list.split(",")) {
    const m = /^\s*(\w+)(?:::[\w:{]+)?(?:\s+as\s+(\w+))?\s*$/.exec(entry);
    if (m) entries.push([m[1], m[2]]);
  }
  return entries;
}

// `pub [unsafe|safe|const|async|extern "C"]* <kind> <name>`, anchored by the caller.
const PUB_ITEM = String.raw`pub\s+(?:(?:unsafe|safe|const|async|extern\s+"[^"]*")\s+)*(?:fn|struct|enum|union|type|const|static|trait|mod)\s+(?:mut\s+)?(\w+)`;
const TOP_LEVEL_ITEM = new RegExp(`^${PUB_ITEM}`);
// Items one level down that still land at the module top level: the contents
// of `extern "C" { .. }` blocks and of item-producing macro invocations such
// as `thread_local! { .. }` / `bitflags! { .. }`.
const ITEM_BLOCK_START = /^(?:(?:unsafe\s+)?extern\s+"[^"]*"|\w+!)\s*\{/;
const ITEM_BLOCK_CHILD = new RegExp(`^ {4}${PUB_ITEM}`);

/**
 * Items reachable as `bun_libuv_sys::<name>`: what lib.rs declares itself plus
 * everything `pub` at the top level of libuv.rs, which lib.rs re-exports with
 * `pub use libuv::*`. Relies on rustfmt's layout (enforced in CI): items at
 * column 0, the children of an item block indented by exactly four spaces.
 */
function crateRootExports(): { exports: Set<string>; unfollowedGlobs: string[] } {
  const exports = new Set<string>();
  const unfollowedGlobs: string[] = [];

  for (const file of ["lib.rs", "libuv.rs"]) {
    const source = stripComments(readFileSync(path.join(root, "src", "libuv_sys", file), "utf8"));

    let inItemBlock = false;
    for (const line of source.split("\n")) {
      if (inItemBlock) {
        if (line.startsWith("}")) inItemBlock = false;
        const child = ITEM_BLOCK_CHILD.exec(line);
        if (child) exports.add(child[1]);
        continue;
      }
      if (ITEM_BLOCK_START.test(line)) {
        inItemBlock = true;
        continue;
      }
      const item = TOP_LEVEL_ITEM.exec(line);
      if (item) exports.add(item[1]);
      const macro = /^macro_rules!\s+(\w+)/.exec(line);
      if (macro) exports.add(macro[1]);
    }

    // `pub use a::b::{X, Y as Z};`, `pub use a::b::X;`, `pub use a::b as c;`
    for (const m of source.matchAll(/^pub use\s+(?:::)?([\w:]+?)(?:::\{([^}]*)\})?(?:\s+as\s+(\w+))?\s*;/gm)) {
      const [, modulePath, list, alias] = m;
      const last = modulePath.split("::").at(-1)!;
      if (list === undefined) {
        exports.add(alias ?? last);
        continue;
      }
      for (const [name, entryAlias] of useListEntries(list)) {
        exports.add(entryAlias ?? (name === "self" ? last : name));
      }
    }
    // The one glob this lint follows is lib.rs's `pub use libuv::*` (libuv.rs
    // is scanned directly above). Any other glob re-export would add names
    // this scan cannot see, so it has to be taught here rather than ignored.
    for (const m of source.matchAll(/^pub use\s+([\w:]+)::\*\s*;/gm)) {
      if (!(file === "lib.rs" && m[1] === "libuv")) unfollowedGlobs.push(`src/libuv_sys/${file}: ${m[0]}`);
    }
  }

  return { exports, unfollowedGlobs };
}

// Paths that denote the crate itself: the crate name, or the `libuv` module
// `bun_sys::windows` re-exports it as (`pub use bun_libuv_sys as libuv`),
// reached as `bun_sys::windows::libuv`, `crate::windows::libuv`, etc.
const CRATE_PATH = String.raw`(?:(?:::)?bun_libuv_sys|[\w:]*\bwindows::libuv)`;
const CRATE_ALIAS = new RegExp(String.raw`\buse\s+${CRATE_PATH}(?:\s+as\s+(\w+))?\s*;`, "g");
const CRATE_ITEM_IMPORT = new RegExp(String.raw`\buse\s+${CRATE_PATH}::(?:\{([^}]*)\}|(\w+))`, "g");
/** The name a `use <crate>;` / `use <crate>::{self}` binds, given the matched text. */
const boundName = (matched: string) => (matched.includes("bun_libuv_sys") ? "bun_libuv_sys" : "libuv");

// Only files tracked in HEAD are scanned, so an untracked leftover under src/
// (or a copy reached through the `src/cli` symlink) cannot fail the lint.
const tracked: Set<string> | null = (() => {
  const r = Bun.spawnSync({
    cmd: ["git", "-C", root, "ls-tree", "-r", "--name-only", "-z", "HEAD"],
    stdout: "pipe",
    stderr: "ignore",
  });
  return r.success ? new Set(r.stdout.toString().split("\0")) : null;
})();

/**
 * Resolves every crate-root name the rest of src/ reaches through the crate
 * against `exports`. Returns how many references were resolved (so an empty
 * scan cannot pass vacuously) and the `file:line: name` of each unresolved one.
 */
function resolveReferences(exports: Set<string>): { resolved: number; missing: string[] } {
  let resolved = 0;
  const missing = new Set<string>();

  for (const file of new Bun.Glob("src/**/*.rs").scanSync({ cwd: root })) {
    const rel = file.replaceAll(path.sep, "/");
    if (rel.startsWith("src/libuv_sys/") || (tracked !== null && !tracked.has(rel))) continue;
    const raw = readFileSync(path.join(root, file), "utf8");
    if (!/\bbun_libuv_sys\b|\blibuv\b/.test(raw)) continue;
    const source = stripComments(raw);

    const check = (offset: number, name: string) => {
      if (exports.has(name)) resolved++;
      else missing.add(`${rel}:${source.slice(0, offset).split("\n").length}: ${name}`);
    };

    // Local names bound to the crate as a whole: `use bun_libuv_sys as uv;`,
    // `use bun_sys::windows::libuv;`, `use bun_sys::windows::{self, libuv as uv};`
    const aliases = new Set<string>();
    for (const m of source.matchAll(CRATE_ALIAS)) aliases.add(m[1] ?? boundName(m[0]));
    for (const m of source.matchAll(/\buse\s+[\w:]*\bwindows::\{([^}]*)\}/g)) {
      for (const [name, alias] of useListEntries(m[1])) if (name === "libuv") aliases.add(alias ?? "libuv");
    }

    // Imports of items: `use <crate>::X;`, `use <crate>::X as Y;`,
    // `use <crate>::{A, B as _, C::{..}};` (`self` in the list binds the crate).
    for (const m of source.matchAll(CRATE_ITEM_IMPORT)) {
      if (m[1] === undefined) {
        check(m.index, m[2]);
        continue;
      }
      for (const [name, alias] of useListEntries(m[1])) {
        if (name === "self") aliases.add(alias ?? boundName(m[0]));
        else check(m.index, name);
      }
    }
    // `use libuv as uv;` re-aliasing a name bound above.
    for (const m of source.matchAll(/\buse\s+(\w+)\s+as\s+(\w+)\s*;/g)) if (aliases.has(m[1])) aliases.add(m[2]);

    // Paths: `bun_libuv_sys::X`, `bun_sys::windows::libuv::X`, `<alias>::X`.
    // Only the first segment after the crate is a crate-root item
    // (`uv::O::RDONLY` checks `O`).
    for (const m of source.matchAll(/\bbun_libuv_sys::(?:libuv::)?(\w+)/g)) check(m.index, m[1]);
    for (const m of source.matchAll(/\bwindows::libuv::(\w+)/g)) check(m.index, m[1]);
    for (const alias of aliases) {
      if (alias === "bun_libuv_sys" || alias === "_") continue;
      for (const m of source.matchAll(new RegExp(String.raw`(?<![\w:])${alias}::(\w+)`, "g"))) check(m.index, m[1]);
    }
  }

  return { resolved, missing: [...missing].sort() };
}

const { exports, unfollowedGlobs } = crateRootExports();
const { resolved, missing } = resolveReferences(exports);

test("the export scan sees each declaration shape the crate uses", () => {
  expect(unfollowedGlobs).toEqual([]);
  // A struct, an extern "C" declaration, a trait, an inline module, a lib.rs
  // constant and a `pub use` re-export.
  const anchors = ["Loop", "uv_loop_init", "UvHandle", "O", "UV_DIRENT_FILE", "sockaddr"];
  expect(anchors.filter(name => !exports.has(name))).toEqual([]);
});

test("every bun_libuv_sys item referenced outside the crate is exported by it", () => {
  expect(resolved).toBeGreaterThan(0);
  expect(missing).toEqual([]);
});
