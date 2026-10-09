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
// that needs it. The inventory does not take it: `--update` leaves out what grows.
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

// A module of helpers for the rules of a plugin that are still being written: a helper has no user until its rule is there.
// Only beside `rules/` of these crates, only as the first line, only with these words. It goes when the plugin is whole.
const UNTIL_WRITTEN = "#![allow(dead_code)] // until every rule of the plugin is written\n";
const HELPERS = /^src\/lint\/(?:unicorn|react|jest|plugins)\/[a-z0-9_]+\.rs$/;
const WAITING = "dead_code, until every rule of the plugin is written";

type Inventory = Record<string, string[]>;
const found: Inventory = {};
let scanned = 0;

for (const abs of globAllSources().rust.filter(p => p.endsWith(".rs"))) {
  const source = path.relative(root, abs).replaceAll(path.sep, "/");
  if (path.relative(root, realpathSync(abs)).replaceAll(path.sep, "/") !== source) continue;
  scanned++;
  const text = await file(abs).text();
  const isWaiting = HELPERS.test(source) && text.startsWith(UNTIL_WRITTEN);
  const stripped = text.slice(isWaiting ? UNTIL_WRITTEN.length : 0).replace(/^\s*\/\/.*$/gm, "");
  const lints = [...stripped.matchAll(INNER)].flatMap(it =>
    it[1]
      .split(",")
      .map(it => it.trim())
      .filter(it => it !== "" && !it.startsWith("reason")),
  );
  if (isWaiting) lints.push(WAITING);
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
  // A file can be moved or split. No lint can be allowed more often than before: of such a lint the inventory stays as
  // it is, so that one who has removed an allow does not wait for a stranger who has added one.
  const before: Inventory = await Bun.file(INVENTORY)
    .json()
    .catch(() => ({}));
  const isFirst = Object.keys(before).length === 0;
  const [was, is] = [totals(before), totals(normalized)];
  const grown = isFirst ? [] : Object.keys(is).filter(lint => lint !== WAITING && is[lint] > (was[lint] ?? 0));
  const files: Inventory = {};
  for (const [source, lints] of Object.entries(normalized)) {
    for (const lint of lints) if (!grown.includes(lint)) (files[source] ??= []).push(lint);
  }
  for (const [source, lints] of Object.entries(before)) {
    for (const lint of lints) if (grown.includes(lint)) (files[source] ??= []).push(lint);
  }
  const sorted: Inventory = Object.fromEntries(
    Object.entries(files)
      .map(([source, lints]) => [source, lints.sort()] as const)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)),
  );
  await Bun.write(INVENTORY, JSON.stringify(sorted, null, 2) + "\n");
  console.log(`Wrote ${Object.keys(sorted).length} files to ${path.basename(INVENTORY)}`);
  for (const lint of grown) {
    console.error(`NOT #![allow(${lint})]: ${was[lint] ?? 0} -> ${is[lint]}: the inventory only shrinks.`);
  }
  process.exit(grown.length > 0 ? 1 : 0);
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
      return at < 0 && lint !== WAITING;
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
