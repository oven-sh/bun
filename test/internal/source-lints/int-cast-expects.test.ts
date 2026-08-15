// Per-file ceiling on `.expect("int cast")` sites in the Rust sources.
//
// `T::try_from(x).expect("int cast")` is how the port spelled Zig's `@intCast`.
// Zig only trapped on it in Debug/ReleaseSafe builds; the Rust tree builds with
// `panic = "abort"`, so every one of these is a crash in the shipped binary for
// any value that does not fit, and a number of them have turned out to be
// reachable from user input (bun:ffi offsets and lengths, --cpu-prof-interval,
// gunzipSync output over 4 GiB, an oversized http2 origin, a corrupt
// --compile-executable-path template, ...). int-cast-expect-limits.json pins
// the count per file: a file may not gain sites, and a file that is not listed
// may not have any. Going below a limit is fine; lower the limits whenever you
// like with
//   bun ./test/internal/source-lints/int-cast-expects.test.ts --update
//
// A site is cleared by making the conversion honest about where its value
// comes from:
//   - a value from outside (a file, the network, a JS argument, a C library):
//     a checked conversion that returns the function's error, or throws the
//     RangeError / validation error its neighbours throw;
//   - a value that a check right above, or its type, already bounds: a plain
//     conversion (`From`, or `as` for a widening), so there is nothing left to
//     abort on.
// Respelling the abort (`.unwrap()`, another message) or narrowing with a lossy
// `as` is not a clear. This file cannot tell the difference; it counts the one
// canonical spelling so that new sites get noticed in review.

import { file } from "bun";
import { describe, test } from "bun:test";
import path from "path";
import { sortedInventory, trackedRustSources, withoutLineComments } from "./rust-sources.ts";

const SITE = /\.expect\(\s*"int cast"\s*\)/g;
const LIMITS = path.join(import.meta.dir, "int-cast-expect-limits.json");
const UPDATE = "bun ./test/internal/source-lints/int-cast-expects.test.ts --update";

const counts: Record<string, number> = {};
for (const { source, abs } of trackedRustSources()) {
  const text = await file(abs).text();
  if (!text.includes("int cast")) continue;
  // Whole-file scan so a call rustfmt wrapped onto its own line still counts.
  const n = [...withoutLineComments(text).matchAll(SITE)].length;
  if (n > 0) counts[source] = n;
}

if (process.argv.includes("--update")) {
  const inventory = sortedInventory(counts);
  await Bun.write(LIMITS, JSON.stringify(inventory, null, 2) + "\n");
  const total = Object.values(inventory).reduce((a, b) => a + b, 0);
  console.log(`Wrote ${Object.keys(inventory).length} files (${total} sites) to ${path.basename(LIMITS)}`);
  process.exit(0);
}

const limits: Record<string, number> = await file(LIMITS).json();
const files = [...new Set([...Object.keys(limits), ...Object.keys(counts)])].sort();

const belowLimit = files.filter(source => (counts[source] ?? 0) < (limits[source] ?? 0));
if (belowLimit.length > 0) {
  console.log(`${belowLimit.length} file(s) are below their int cast limit; lower the limits with: ${UPDATE}`);
}

describe('.expect("int cast") sites', () => {
  test.each(files)("%s", source => {
    const limit = limits[source] ?? 0;
    const count = counts[source] ?? 0;
    if (count > limit) {
      throw new Error(
        `${source} has ${count} .expect("int cast") sites; its limit is ${limit}. Each one aborts the process on a ` +
          `value that does not fit: return an error from the failed conversion, or use a plain conversion where the ` +
          `value is already bounded (see the header of int-cast-expects.test.ts). If a site really is unavoidable, ` +
          `raise the limit with \`${UPDATE}\` and say why in the PR.`,
      );
    }
  });
});
