import { file } from "bun";
import { expect, test } from "bun:test";
import { realpathSync } from "fs";
import path from "path";
import { globAllSources } from "../../../scripts/glob-sources.ts";

// The bundler's plugin hops must not touch the bundle pass that posted them.
//
// `Resolve::run_on_js_thread`, `Load::run_on_js_thread` (src/bundler/bundle_v2.rs)
// and `DeferredBatchTask::run_on_js_thread` are the tasks a `BundleV2` posts to
// the plugins' JS thread. For `Bun.build` the pass stays on the bundle thread,
// which is inside `wait_for_parse` holding `&mut BundleV2` and mutating it while
// the hop runs, so everything a hop needs (the plugin handle, the import record,
// the path) is copied into the hop when it is built, and its body reads only its
// own fields. This tree used to have all three reach back into the pass
// (`&mut *self.bv2` / a `from_field_ptr!` walk-back, then `plugins_mut()`), i.e.
// form a second `&mut` to a struct another thread was writing through its own.
//
// A hop body therefore may not mention any route back to the pass: the `bv2`
// backref (kept for `dispatch()` and the answer, which run on the pass's own
// loop), `BundleV2` itself, the parse task's `ctx` backref, a `from_field_ptr!` /
// `container_of` walk-back, an accessor named after the pass, or the pass's
// `plugins_ref()` / `plugins_mut()` projections. Something new a hop needs gets
// copied in at construction like the rest.
//
// Out of scope: the answer thunks in src/runtime/api/JSBundler.rs, which post
// back to the pass's loop and are their own population.

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
const ROUTE_TO_PASS =
  /\bBundleV2\b|\b\w*(?:bv2|bundle_v2)\w*\b|\bfrom_field_ptr\b|\bcontainer_of\b|\bctx\b|\bplugins_(?:ref|mut)\b/g;

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

const hops: string[] = [];
const hits: { source: string; line: number; text: string }[] = [];
let scanned = 0;
for (const abs of bundlerSources) {
  const source = path.relative(root, abs).replaceAll(path.sep, "/");
  if (path.relative(root, realpathSync(abs)).replaceAll(path.sep, "/") !== source) continue;
  if (tracked !== null && !tracked.has(source)) continue;
  scanned++;
  const content = await file(abs).text();
  // Strip comments (full-line ones first, keeping the newline so line numbers
  // hold; then trailing ones) so prose does not count. The hop bodies contain
  // no braces or `//` inside string literals, which is what this would misread.
  const stripped = content.replace(/^[ \t]*\/\/.*$/gm, "").replace(/[ \t]\/\/.*$/gm, "");
  for (const m of stripped.matchAll(HOP)) {
    hops.push(source);
    const block = blockAfter(stripped, m.index + m[0].length);
    if (block === null) {
      hits.push({ source, line: lineOf(stripped, m.index), text: "could not find the body of run_on_js_thread" });
      continue;
    }
    for (const hit of block.body.matchAll(ROUTE_TO_PASS)) {
      hits.push({ source, line: lineOf(stripped, block.start + hit.index), text: hit[0] });
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
  // If this changes, a hop was added, removed or moved: update this list (and
  // the header), not the ban below.
  expect(hops.sort()).toEqual([
    "src/bundler/DeferredBatchTask.rs",
    "src/bundler/bundle_v2.rs",
    "src/bundler/bundle_v2.rs",
  ]);
});

test("plugin hop bodies do not reach back into the pass that posted them", () => {
  expect(offenders).toEqual([]);
});
