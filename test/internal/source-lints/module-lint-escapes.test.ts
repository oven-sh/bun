// Inventory of module-level `#![allow(dead_code)]` / `#![allow(unreachable_pub)]`
// escapes in the Rust sources.
//
// The workspace compiles with `dead_code = "deny"` and `unreachable_pub = "deny"`,
// so an item nothing uses fails the build, and a `pub` item has to be imported
// by another crate. A module-level `#![allow(...)]` for either lint switches
// that analysis off for the whole file: every item in it can go dead without a
// compile error, and `pub` stops meaning "another crate uses this". The
// sibling `dead-code-escapes.test.ts` pins the item-level escapes; this file
// pins the module-level ones, per file, so a new opt-out is a deliberate
// change to this inventory and a file that drops its opt-out updates it.
//
// If this test fails because a count went UP: prefer deleting the dead items
// (or narrowing `pub` to `pub(crate)`) over adding the module-level escape. If
// the escape is justified (a codegen surface, a port that is wired up in
// stages), update the inventory by running
// `bun ./test/internal/source-lints/module-lint-escapes.test.ts --write`.
//
// If it fails because a count went DOWN: you removed an escape. Update the
// inventory the same way so it stays accurate.

import { file } from "bun";
import { describe, test } from "bun:test";
import { realpathSync } from "fs";
import path from "path";
import { globAllSources } from "../../../scripts/glob-sources.ts";

// A module-level `#![allow(...)]`, including one that rustfmt wrapped across
// several lines. `[^\]]*` cannot cross a `]`, so a match never spans from one
// attribute into the next.
const MODULE_ALLOW = /#!\[\s*allow\(([^\]]*)\)\s*\]/g;
// The lint names inside the attribute. `\b` keeps `clippy::dead_code`-style
// paths from matching only when the segment is the bare rustc lint.
const ESCAPED_LINT = /(?<![\w:])(dead_code|unreachable_pub)\b/;

const limits: Record<string, number> = await Bun.file(import.meta.dir + "/module-lint-escapes.json").json();

const root = path.resolve(import.meta.dir, "..", "..", "..");
const rustSources = globAllSources().rust.filter(p => p.endsWith(".rs"));

// Only count files tracked in HEAD, for the same reason as
// dead-code-escapes.test.ts: stray `.rs` files a branch deletes can come back
// during a `git stash` round-trip, and they must not fail the ratchet.
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
  const content = await file(abs).text();
  // Strip full-line `//` comments first so a commented-out escape stays ignored.
  const stripped = content.replace(/^\s*\/\/.*$/gm, "");
  let n = 0;
  for (const [, lints] of stripped.matchAll(MODULE_ALLOW)) {
    if (ESCAPED_LINT.test(lints)) n++;
  }
  if (n > 0) counts[source] = n;
}

if (process.argv.includes("--write")) {
  // `bun ./test/internal/source-lints/module-lint-escapes.test.ts --write`:
  // regenerate the inventory from the current tree.
  const sorted = Object.fromEntries(Object.entries(counts).sort(([a], [b]) => (a < b ? -1 : 1)));
  await Bun.write(import.meta.dir + "/module-lint-escapes.json", JSON.stringify(sorted, null, 2) + "\n");
  console.log(`Wrote ${Object.keys(sorted).length} files to module-lint-escapes.json`);
  process.exit(0);
}

describe("module-level #![allow(dead_code)] / #![allow(unreachable_pub)] escapes", () => {
  const files = new Set([...Object.keys(limits), ...Object.keys(counts)]);
  for (const source of [...files].sort()) {
    const limit = limits[source] ?? 0;
    const count = counts[source] ?? 0;
    test(`${source} (${limit})`, () => {
      if (count > limit) {
        throw new Error(
          `${source} has ${count} module-level dead_code/unreachable_pub escapes, up from ${limit}.\n` +
            `A module-level escape hides every dead item in the file from the compiler. Delete the dead items or use pub(crate) instead.\n` +
            `If the escape is justified, update the inventory with \`bun ./test/internal/source-lints/module-lint-escapes.test.ts --write\`.`,
        );
      } else if (count < limit) {
        throw new Error(
          `${source} has ${count} module-level dead_code/unreachable_pub escapes, down from ${limit}.\n` +
            `Update the inventory with \`bun ./test/internal/source-lints/module-lint-escapes.test.ts --write\`.`,
        );
      }
    });
  }
});
