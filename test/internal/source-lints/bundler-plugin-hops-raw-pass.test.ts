import { file } from "bun";
import { expect, test } from "bun:test";
import { realpathSync } from "fs";
import path from "path";
import { globAllSources } from "../../../scripts/glob-sources.ts";

// The bundler's plugin hops must not borrow the bundle pass they belong to.
//
// `Resolve::run_on_js_thread`, `Load::run_on_js_thread` (bundle_v2.rs) and
// `DeferredBatchTask::run_on_js_thread` are the three tasks a `BundleV2`
// posts to the plugins' JS thread (`enqueue_on_js_loop_for_plugins`; the
// runtime's `run_task` dispatches them there). For `Bun.build` the pass itself
// stays on the bundle thread, which at that moment is inside `wait_for_parse`
// reborrowing the whole struct as `&mut BundleV2` on every `is_done` and
// writing `graph.*` through it, while parse workers read it as `&BundleV2`.
// The hops hold only a raw pointer to the pass (`Resolve::bv2` / `Load::bv2`,
// or the `drain_defer_task` field walk-back), and the only thing they need
// from it is `plugins` (plus `completion` for the deferred batch): `Copy`
// fields fixed before the pass started. So a hop reads those through the
// pointer (`BundleV2::plugins_on_js_thread` takes `*const Self`) and never
// materializes a `&BundleV2` or `&mut BundleV2` on the plugin thread. This
// tree used to form `&mut *self.bv2` / `&mut *from_field_ptr!(BundleV2, ..)`
// in all three, purely to call `plugins_mut(&mut self)`: a second live `&mut`
// to a struct another thread was writing through its own.
//
// Banned inside those bodies (the enforcement boundary; a hop that needs
// something new from the pass gets another raw-pointer associated fn next to
// `plugins_on_js_thread`, not a borrow):
//
//   1. reborrowing the pass: `&mut *..bv2`, `&*..bv2`, or the same applied to
//      a `from_field_ptr!` / `container_of` walk-back;
//   2. the `&self` / `&mut self` projections `.plugins_ref()` / `.plugins_mut()`,
//      which can only be called on such a borrow;
//   3. accessor calls handing the pass back (`.get_bundle_v2()` and the like).
//
// Not covered, deliberately: `dispatch()`, `on_load_from_js_loop` and the other
// `&mut *x.bv2` sites in bundle_v2.rs run on the loop that owns the pass (the
// bundle thread, or bake's JS loop between its own tasks), where that `&mut`
// is the owner's. The answer thunks in src/runtime/api/JSBundler.rs also post
// from the plugin thread and are their own population.
//
// Sibling guards: fn-long-mut-reborrow.test.ts, frozen-nonnull-reborrow.test.ts.

const root = path.resolve(import.meta.dir, "..", "..", "..");
const bundlerSources = globAllSources().rust.filter(
  p => p.endsWith(".rs") && path.relative(root, p).replaceAll(path.sep, "/").startsWith("src/bundler/"),
);

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

const HOP = /\bfn\s+run_on_js_thread\b/g;

const BANNED: { name: string; pattern: RegExp }[] = [
  {
    name: "reborrows the pass",
    // `&mut *self.bv2`, `&*load.bv2`, `&mut *bun_core::from_field_ptr!(BundleV2, ..)`.
    // `[^;{}]*?` keeps the operand inside one expression.
    pattern: /&\s*(?:mut\s+)?\*\s*[^;{}]*?(?:\bbv2\b|\bfrom_field_ptr!|\bcontainer_of\b)/g,
  },
  {
    name: "projects plugins through a borrow of the pass",
    pattern: /\.\s*plugins_(?:ref|mut)\s*\(/g,
  },
  {
    name: "calls an accessor that hands the pass back",
    pattern: /\.\s*\w*(?:bundle_v2|bv2)\w*\s*\(/g,
  },
];

function lineOf(text: string, index: number): number {
  return text.slice(0, index).split("\n").length;
}

/** The `{ .. }` block starting at the first `{` at or after `from`. */
function blockAfter(text: string, from: number): { start: number; body: string } | null {
  const start = text.indexOf("{", from);
  if (start < 0) return null;
  let depth = 0;
  for (let i = start; i < text.length; i++) {
    const c = text[i];
    if (c === "{") depth++;
    else if (c === "}" && --depth === 0) return { start, body: text.slice(start, i + 1) };
  }
  return null;
}

const hops: { source: string; line: number }[] = [];
const hits: { source: string; line: number; text: string }[] = [];
let scanned = 0;
for (const abs of bundlerSources) {
  const source = path.relative(root, abs).replaceAll(path.sep, "/");
  if (path.relative(root, realpathSync(abs)).replaceAll(path.sep, "/") !== source) continue;
  if (tracked !== null && !tracked.has(source)) continue;
  scanned++;
  const content = await file(abs).text();
  // Strip comments (full-line ones first, keeping the newline so line numbers
  // hold; then trailing ones) so prose about the banned shapes does not count.
  // None of the hop bodies contain braces or `//` inside string literals,
  // which is what this simple scan would misread.
  const stripped = content.replace(/^[ \t]*\/\/.*$/gm, "").replace(/[ \t]\/\/.*$/gm, "");
  for (const m of stripped.matchAll(HOP)) {
    const line = lineOf(stripped, m.index);
    hops.push({ source, line });
    const block = blockAfter(stripped, m.index + m[0].length);
    if (block === null) {
      hits.push({ source, line, text: "could not find the body of run_on_js_thread" });
      continue;
    }
    for (const { name, pattern } of BANNED) {
      for (const hit of block.body.matchAll(pattern)) {
        hits.push({
          source,
          line: lineOf(stripped, block.start + hit.index),
          text: `${hit[0].replace(/\s+/g, " ").trim()} (${name})`,
        });
      }
    }
  }
}
const offenders = hits
  .sort((a, b) => a.source.localeCompare(b.source) || a.line - b.line)
  .map(h => `${h.source}:${h.line}: ${h.text}`);

test("scans the tracked sources of the bundler crate", () => {
  // Guards against the tracked/realpath filters above over-firing and leaving
  // nothing to scan, which would make the assertions below pass vacuously.
  expect(scanned).toBeGreaterThan(0);
});

test("the three plugin hops are still where this lint looks for them", () => {
  // If this changes, a hop was added, removed or moved: update the list (and
  // the header) rather than the ban below. Two are `Resolve` / `Load` in
  // bundle_v2.rs, one is `DeferredBatchTask`.
  expect(hops.map(h => h.source).sort()).toEqual([
    "src/bundler/DeferredBatchTask.rs",
    "src/bundler/bundle_v2.rs",
    "src/bundler/bundle_v2.rs",
  ]);
});

test("plugin hops reach the pass only through its raw pointer", () => {
  expect(offenders).toEqual([]);
});
