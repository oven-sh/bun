// Inventory of scope-layer escape hatches in the Rust sources.
//
// The branded scope layer (src/jsc/scope.rs) guarantees that user-JS
// re-entry is an effect (`&mut Scope`) and that JS values cannot escape
// their scope unrooted. Two constructs opt out of those guarantees and are
// pinned here per file, monotonically:
//
//   1. `Scope::unscoped_global()` / `Local::unscoped()` — reach legacy APIs
//      that can run user JS without `&mut Scope`, bypassing the re-entry
//      guarantee for surrounding scoped code.
//   2. `#[bun_jsc::host_fn]` without the `scoped` flag — an entry point
//      whose body handles raw `JSValue`s with no scope at all.
//
// If this test fails because a count went UP: prefer routing through the
// scoped API (a `Local` method, or a `scoped` wrapper generated from a
// `ZIG_EXPORT(..., reenters_js | no_user_js)` annotation) instead of adding
// a hatch. If the hatch is genuinely needed (the API it reaches is not yet
// classified), update the limits by running
// `bun ./test/internal/scope-escapes.test.ts --update`.
//
// If it fails because a count went DOWN: you removed hatches — update the
// limits the same way so the inventory stays accurate.

import { file } from "bun";
import { describe, test } from "bun:test";
import { realpathSync } from "fs";
import path from "path";
import { globAllSources } from "../../scripts/glob-sources.ts";

const UNSCOPED_GLOBAL = /\bunscoped_global\s*\(\s*\)|\.unscoped\s*\(\s*\)/g;
// `#[bun_jsc::host_fn]` / `#[bun_jsc::host_fn(method)]` etc. without the
// `scoped` flag anywhere in the attribute args.
const HOST_FN = /#\[\s*bun_jsc::host_fn\s*(?:\(([^)]*)\))?\s*\]/g;

const limits: Record<string, number> = await Bun.file(import.meta.dir + "/scope-escape-limits.json").json();

const root = path.resolve(import.meta.dir, "..", "..");
const rustSources = globAllSources().rust.filter(p => p.endsWith(".rs"));

// The definition site does not count as a use.
const DEFINITION_FILES = new Set(["src/jsc/scope.rs"]);

// Only count files tracked in HEAD (mirrors dead-code-escapes.test.ts).
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
for (const abs of rustSources) {
  const source = path.relative(root, abs).replaceAll(path.sep, "/");
  // `src/cli` is a symlink into `src/runtime/cli`; count each file once
  // under its canonical path.
  if (path.relative(root, realpathSync(abs)).replaceAll(path.sep, "/") !== source) continue;
  if (tracked !== null && !tracked.has(source)) continue;
  if (DEFINITION_FILES.has(source)) continue;
  const content = await file(abs).text();
  const stripped = content.replace(/^\s*\/\/.*$/gm, "");
  let n = [...stripped.matchAll(UNSCOPED_GLOBAL)].length;
  for (const m of stripped.matchAll(HOST_FN)) {
    if (!/\bscoped\b/.test(m[1] ?? "")) n += 1;
  }
  if (n > 0) counts[source] = n;
}

if (process.argv.includes("--update")) {
  // Explicit regeneration (`bun ./test/internal/scope-escapes.test.ts --update`).
  // Gated on an argv flag so a `bun test` run can never overwrite the inventory.
  const sorted = Object.fromEntries(Object.entries(counts).sort(([a], [b]) => (a < b ? -1 : 1)));
  await Bun.write(import.meta.dir + "/scope-escape-limits.json", JSON.stringify(sorted, null, 2) + "\n");
  console.log(`Wrote ${Object.keys(sorted).length} files to scope-escape-limits.json`);
  process.exit(0);
}

describe("scope-layer escape hatches", () => {
  const files = new Set([...Object.keys(limits), ...Object.keys(counts)]);
  for (const source of [...files].sort()) {
    const limit = limits[source] ?? 0;
    const count = counts[source] ?? 0;
    test(`${source} (${limit})`, () => {
      if (count > limit) {
        throw new Error(
          `${source} has ${count} scope escape hatches (unscoped_global / .unscoped() / unscoped #[bun_jsc::host_fn]), up from ${limit}.\n` +
            `Route through the scoped API instead: a Local method, or a scoped wrapper generated from a\n` +
            `ZIG_EXPORT(..., reenters_js | no_user_js) annotation on the C++ declaration.\n` +
            `If the hatch is justified (target API not yet classified), update the inventory with\n` +
            `\`bun ./test/internal/scope-escapes.test.ts --update\`.`,
        );
      } else if (count < limit) {
        throw new Error(
          `${source} has ${count} scope escape hatches, down from ${limit}.\n` +
            `Update the inventory with \`bun ./test/internal/scope-escapes.test.ts --update\`.`,
        );
      }
    });
  }
});
