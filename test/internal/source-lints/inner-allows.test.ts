// No new `#![allow(..)]` in the Rust sources.
//
// `[workspace.lints]` in the root Cargo.toml denies every warning and much of clippy, and workspace-lints.test.ts sees to
// it that every crate inherits that. An inner attribute at the top of a crate or a module takes it back for everything
// below, without a word in any manifest: `#![allow(clippy::disallowed_methods)]` in a lib.rs turns clippy.toml off for a
// whole crate.
//
// What was there when the lint was written (bindings that are generated, ports of C headers, build scripts) is in
// inner-allows.inventory.json, by file. It can only shrink.
//
// If this fails because you ADDED one: repair what the lint reports, or put `#[allow(..)]` with a reason on the one item
// that needs it. The inventory does not take it: `--update` refuses what grows.
// If it fails because you REMOVED or MOVED one:
//   bun ./test/internal/source-lints/inner-allows.test.ts --update

import { file } from "bun";
import { describe, expect, test } from "bun:test";
import { realpathSync } from "fs";
import path from "path";
import { globAllSources } from "../../../scripts/glob-sources.ts";

const root = path.resolve(import.meta.dir, "..", "..", "..");
const INVENTORY = import.meta.dir + "/inner-allows.inventory.json";

// `#![allow(a, b)]`, `#![expect(a)]`, `#![cfg_attr(<predicate>, allow(a))]`, on one line or wrapped by rustfmt.
const INNER = /#!\[\s*(?:cfg_attr\([^\]]+?,\s*)?(?:allow|expect)\(([^)]*)\)[^\]]*\]/g;

// Only files tracked in HEAD: see dead-code-escapes.test.ts.
const tracked: Set<string> | null = (() => {
  const r = Bun.spawnSync({
    cmd: ["git", "-C", root, "ls-tree", "-r", "--name-only", "-z", "HEAD"],
    stdout: "pipe",
    stderr: "ignore",
  });
  if (!r.success) return null;
  return new Set(r.stdout.toString().split("\0").filter(Boolean));
})();

type Inventory = Record<string, string[]>;
const found: Inventory = {};
let scanned = 0;

for (const abs of globAllSources().rust.filter(p => p.endsWith(".rs"))) {
  const source = path.relative(root, abs).replaceAll(path.sep, "/");
  if (path.relative(root, realpathSync(abs)).replaceAll(path.sep, "/") !== source) continue;
  if (tracked !== null && !tracked.has(source)) continue;
  scanned++;
  const stripped = (await file(abs).text()).replace(/^\s*\/\/.*$/gm, "");
  const lints = [...stripped.matchAll(INNER)].flatMap(it =>
    it[1]
      .split(",")
      .map(it => it.trim())
      .filter(it => it !== "" && !it.startsWith("reason")),
  );
  if (lints.length > 0) found[source] = lints.sort();
}

const normalized: Inventory = Object.fromEntries(
  Object.entries(found).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)),
);

const totals = (inventory: Inventory) => {
  const all: Record<string, number> = {};
  for (const lint of Object.values(inventory).flat()) all[lint] = (all[lint] ?? 0) + 1;
  return all;
};

if (process.argv.includes("--update")) {
  // A file can be moved or split. No lint can be allowed more often than before.
  const before: Inventory | null = await Bun.file(INVENTORY)
    .json()
    .catch(() => null);
  if (before !== null) {
    const [was, is] = [totals(before), totals(normalized)];
    const grown = Object.keys(is).filter(lint => is[lint] > (was[lint] ?? 0));
    if (grown.length > 0) {
      for (const lint of grown) console.error(`#![allow(${lint})]: ${was[lint] ?? 0} -> ${is[lint]}`);
      console.error("The inventory only shrinks: not written.");
      process.exit(1);
    }
  }
  await Bun.write(INVENTORY, JSON.stringify(normalized, null, 2) + "\n");
  console.log(`Wrote ${Object.keys(normalized).length} files to ${path.basename(INVENTORY)}`);
  process.exit(0);
}

const inventory: Inventory = await Bun.file(INVENTORY).json();

describe("no new #![allow(..)]", () => {
  test("the sources are found", () => {
    // Guard against a root that resolves wrong, which would make the rest pass vacuously.
    expect(scanned).toBeGreaterThan(2000);
  });

  const files = [...new Set([...Object.keys(inventory), ...Object.keys(normalized)])].sort();
  test.each(files)("%s", source => {
    const expected = inventory[source] ?? [];
    const actual = normalized[source] ?? [];
    const left = [...expected];
    const added = actual.filter(lint => {
      const at = left.indexOf(lint);
      if (at >= 0) left.splice(at, 1);
      return at < 0;
    });
    if (added.length > 0) {
      throw new Error(
        `${source}: a new #![allow(${added.join(", ")})]. It takes the lints of the workspace back for all that is below it. ` +
          `Repair what the lint reports, or put #[allow(..)] with a reason on the one item that needs it.`,
      );
    }
    if (left.length > 0) {
      throw new Error(
        `${source}: fewer inner allows than the inventory has: ${left.join(", ")}. Good.\n` +
          `Regenerate: bun ./test/internal/source-lints/inner-allows.test.ts --update`,
      );
    }
  });
});
