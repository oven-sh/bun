import { file } from "bun";
import { describe, expect, test } from "bun:test";
import { realpathSync } from "fs";
import path from "path";
import { globAllSources } from "../../../scripts/glob-sources.ts";

// `let this = unsafe { &mut *this };` — the fn-long exclusive reborrow of a
// raw pointer — is banned, under any binding name.
//
// The shape asserts exclusive access to the object for the rest of the
// function, but the functions that form it are callbacks (uSockets/libuv
// handlers, task-queue arms, vtable dispatch) or drivers (`Run::start`,
// `WebWorker::spin`, `bun build --app`) whose bodies run JS or dispatch events
// that re-enter the same object through its own accessors
// (`VirtualMachine::get()`, `http_thread()`, a stored back-reference). Under
// Stacked/Tree Borrows the re-entrant access pops the fn-long tag, making every
// later use of the binding UB; before that it's an LLVM `noalias` miscompile
// hazard.
//
// Replacements, in preference order (see the sweep that removed the last ~370
// of these for worked examples):
//   - `let x = unsafe { &*ptr };` when everything reached is `&self` /
//     `Cell`/`JsCell`, with `x.as_mut().m()` for the odd `&mut self` method
//     (TRAMPOLINE) — `Run::start` in src/runtime/cli/run_command.rs.
//   - Statement-scoped raw place access `unsafe { (*ptr).field = v };`, a
//     call-scoped `unsafe { &mut *ptr }` argument, `heap::take(ptr)` Box
//     reclaim, or a `&mut self` prep method invoked as
//     `unsafe { (*ptr).prep() }` (DEAD) — `VirtualMachine::init`.
//   - Convert the type's touched state to `Cell`/`JsCell` and its methods to
//     `&self` (REENTRANT) — exemplars: `src/runtime/ipc.rs` (SendQueue),
//     `src/runtime/socket/UpgradedDuplex.rs`, `src/io/PipeReader.rs`'s raw
//     `read`/`on_poll` entry chain.
//
// Two tiers:
//   1. Operands named like raw callback parameters (`this`, `ctx`, `ptr`, ...)
//      are banned outright; the tree is at zero.
//   2. Every other identifier operand (`&mut *vm_ptr`, `&mut *manager_ptr`,
//      `&mut *vm`, ...) is the same shape reached through a local, and is
//      pinned per file in fn-long-mut-reborrow.inventory.json: the operand
//      names each file still contains. Not every entry is a live bug (some
//      are init windows nothing else can reach yet, some reborrow opaque ZST
//      handles); the inventory exists so that a new one fails here and gets
//      looked at, and so the list only shrinks. Reborrows of field paths and
//      call results (`&mut *self.ptr`, `&mut *x.as_ptr()`) are a further
//      population this lint does not cover.
//
// If this fails because you ADDED one: use one of the replacements above.
// If it fails because you REMOVED one: regenerate the inventory:
//   bun ./test/internal/source-lints/fn-long-mut-reborrow.test.ts --update
//
// Sibling guards: frozen-nonnull-reborrow.test.ts, unsound-erased-box.test.ts,
// static-mut-accessors.test.ts (the accessors that hand out the `&'static mut`
// these sites are re-entered through).

const root = path.resolve(import.meta.dir, "..", "..", "..");
const INVENTORY = import.meta.dir + "/fn-long-mut-reborrow.inventory.json";
const rustSources = globAllSources().rust.filter(p => p.endsWith(".rs"));

// Only scan files tracked in HEAD (a `git stash` round-trip can leave stray
// `.rs` files in the working tree; CI runs on a clean checkout). Same guard as
// dead-code-escapes.test.ts.
const tracked: Set<string> | null = (() => {
  const r = Bun.spawnSync({
    cmd: ["git", "-C", root, "ls-tree", "-r", "--name-only", "-z", "HEAD"],
    stdout: "pipe",
    stderr: "ignore",
  });
  if (!r.success) return null;
  return new Set(r.stdout.toString().split("\0").filter(Boolean));
})();

// A `let` binding (any name, optionally typed) whose whole initializer is
// `unsafe { &mut *<identifier> }`. Matched across newlines so a
// rustfmt-wrapped binding can't evade it. `[^=;{}]*` after the binding name
// permits a type ascription but cannot cross into a different statement; the
// trailing `;` requires the unsafe block to be the entire initializer, so a
// call-scoped `unsafe { &mut *p }.method()` expression does not count, and
// the operand must be a bare identifier followed by `}`, so `&mut *p.as_ptr()`
// and `&mut **p` do not count (see the header).
const REBORROW = /let\s+(?:mut\s+)?\w+\s*(?::[^=;{}]*)?=\s*unsafe\s*\{\s*&mut\s+\*([A-Za-z_]\w*)\s*\}\s*;/g;

// Tier 1: the raw-pointer callback-parameter names used across the tree. If
// you add a new raw callback-param name, add it here.
const CALLBACK_PARAMS = new Set([
  "this",
  "ctx",
  "p",
  "ptr",
  "self_ptr",
  "this_ptr",
  "raw",
  "task",
  "handle",
  "data",
  "context",
  "user_data",
  "parent",
  "client",
  "ws",
  "req",
  "resp",
  "socket",
]);

const offenders: string[] = [];
// Tier 2: file → sorted operand names (one entry per site, so a second
// `&mut *vm_ptr` in a file that already has one still shows up).
const found: Record<string, string[]> = {};
let scanned = 0;
for (const abs of rustSources) {
  const source = path.relative(root, abs).replaceAll(path.sep, "/");
  // `src/cli` is a symlink into `src/runtime/cli`; count each file once under
  // its canonical path.
  if (path.relative(root, realpathSync(abs)).replaceAll(path.sep, "/") !== source) continue;
  if (tracked !== null && !tracked.has(source)) continue;
  scanned++;
  const content = await file(abs).text();
  // Strip full-line comments so prose mentions (including this file) don't
  // count. `[ \t]*`, not `\s*`: `\s` crosses newlines, so a comment preceded
  // by blank lines would swallow them and shift every reported line number.
  const stripped = content.replace(/^[ \t]*\/\/.*$/gm, "");
  for (const m of stripped.matchAll(REBORROW)) {
    const operand = m[1];
    if (CALLBACK_PARAMS.has(operand)) {
      const line = stripped.slice(0, m.index).split("\n").length;
      offenders.push(`${source}:${line}: ${m[0].replace(/\s+/g, " ")}`);
    } else {
      (found[source] ??= []).push(operand);
    }
  }
}

const normalized: Record<string, string[]> = Object.fromEntries(
  Object.entries(found)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([source, names]) => [source, names.sort()]),
);

if (process.argv.includes("--update")) {
  await Bun.write(INVENTORY, JSON.stringify(normalized, null, 2) + "\n");
  console.log(`Wrote ${Object.keys(normalized).length} files to ${path.basename(INVENTORY)}`);
  process.exit(0);
}

const inventory: Record<string, string[]> = await Bun.file(INVENTORY).json();

test("scans a non-empty set of tracked Rust sources", () => {
  // Guards against the tracked/realpath filters above over-firing and leaving
  // nothing to scan, which would make the checks below pass vacuously.
  expect(scanned).toBeGreaterThan(0);
});

test("fn-long `&mut *<callback param>` reborrow is banned", () => {
  expect(offenders).toEqual([]);
});

describe("fn-long `&mut *<local>` reborrow inventory", () => {
  const files = [...new Set([...Object.keys(inventory), ...Object.keys(normalized)])].sort();
  test.each(files)("%s", source => {
    const expected = inventory[source] ?? [];
    const actual = normalized[source] ?? [];
    if (!Bun.deepEquals(actual, expected)) {
      throw new Error(
        `${source}: fn-long \`let x = unsafe { &mut *<local> };\` sites changed.\n` +
          `  inventoried: ${JSON.stringify(expected)}\n` +
          `  in tree:     ${JSON.stringify(actual)}\n` +
          `A new one must be rewritten as a shared reborrow, a statement-scoped raw access, or a call-scoped ` +
          `argument (see the header of this file). After removing one, regenerate: ` +
          `bun ./test/internal/source-lints/fn-long-mut-reborrow.test.ts --update`,
      );
    }
  });
});
