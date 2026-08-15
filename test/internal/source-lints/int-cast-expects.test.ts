// Per-file inventory of `.expect("int cast")` sites in the Rust sources.
//
// `T::try_from(x).expect("int cast")` is the mechanical translation of Zig's
// `@intCast`. Zig only trapped on it in Debug/ReleaseSafe builds; the Rust port
// builds with `panic = "abort"`, so every one of these is a crash in the shipped
// binary for any value that does not fit, and several have turned out to be
// reachable from user input (bun:ffi offsets and lengths, --cpu-prof-interval,
// gunzipSync output over 4 GiB, an oversized http2 origin, ...). This test pins
// the count per file so it can only go down.
//
// To remove a site, rewrite it as one of:
//   - a checked conversion that returns the function's error (or throws the
//     RangeError / validation error its neighbours throw), or
//   - a plain conversion (`From`, or `as` for a widening) where the source
//     type or a range check right above makes it visibly infallible.
//
// If this fails because a count went UP: rewrite the new site as above rather
// than raising its limit. If it fails because a count went DOWN: you removed
// sites, so lower the limits to match:
//   bun ./test/internal/source-lints/int-cast-expects.test.ts --update

import { file } from "bun";
import { describe, test } from "bun:test";
import { realpathSync } from "fs";
import path from "path";
import { globAllSources } from "../../../scripts/glob-sources.ts";

const SITE = /\.expect\(\s*"int cast"\s*\)/g;

const root = path.resolve(import.meta.dir, "..", "..", "..");
const LIMITS = import.meta.dir + "/int-cast-expect-limits.json";
const UPDATE = "bun ./test/internal/source-lints/int-cast-expects.test.ts --update";

// Only count files tracked in HEAD: editors and `git stash` round-trips can
// leave stray `.rs` files in the working tree, and those must not fail the
// ratchet. CI runs against the committed tree, so every real file is covered.
const tracked: Set<string> | null = (() => {
  const r = Bun.spawnSync({
    cmd: ["git", "-C", root, "ls-tree", "-r", "--name-only", "-z", "HEAD"],
    stdout: "pipe",
    stderr: "ignore",
  });
  if (!r.success) return null;
  return new Set(r.stdout.toString().split("\0").filter(Boolean));
})();

const counts: Record<string, number> = {};
for (const abs of globAllSources().rust.filter(p => p.endsWith(".rs"))) {
  const source = path.relative(root, abs).replaceAll(path.sep, "/");
  // `src/cli` is a symlink into `src/runtime/cli`; count each file once
  // under its canonical path.
  if (path.relative(root, realpathSync(abs)).replaceAll(path.sep, "/") !== source) continue;
  if (tracked !== null && !tracked.has(source)) continue;
  const content = await file(abs).text();
  if (!content.includes("int cast")) continue;
  // Whole-file scan so a call rustfmt wrapped onto its own line still counts;
  // full-line `//` comments are stripped so a commented-out site does not.
  const stripped = content.replace(/^\s*\/\/.*$/gm, "");
  const n = [...stripped.matchAll(SITE)].length;
  if (n > 0) counts[source] = n;
}

if (process.argv.includes("--update")) {
  const sorted = Object.fromEntries(Object.entries(counts).sort(([a], [b]) => (a < b ? -1 : 1)));
  await Bun.write(LIMITS, JSON.stringify(sorted, null, 2) + "\n");
  const total = Object.values(sorted).reduce((a, b) => a + b, 0);
  console.log(`Wrote ${Object.keys(sorted).length} files (${total} sites) to ${path.basename(LIMITS)}`);
  process.exit(0);
}

const limits: Record<string, number> = await Bun.file(LIMITS).json();

describe('.expect("int cast") sites', () => {
  const files = [...new Set([...Object.keys(limits), ...Object.keys(counts)])].sort();
  test.each(files)("%s", source => {
    const limit = limits[source] ?? 0;
    const count = counts[source] ?? 0;
    if (count > limit) {
      throw new Error(
        `${source} has ${count} .expect("int cast") sites, up from ${limit}. Each one aborts the process on a value ` +
          `that does not fit. Return an error from the failed conversion instead, or use a plain conversion where the ` +
          `value is already range-checked (see the header of int-cast-expects.test.ts).`,
      );
    }
    if (count < limit) {
      throw new Error(
        `${source} has ${count} .expect("int cast") sites, down from ${limit}. Lower the limit so they cannot come back: ${UPDATE}`,
      );
    }
  });
});
