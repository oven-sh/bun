// Inventory of item-level `#[allow(dead_code)]` escapes in the Rust sources.
//
// The workspace compiles with `dead_code = "deny"`, so every `#[allow(dead_code)]`
// is a deliberate escape hatch. Each one was audited by stripping the attribute
// and running `cargo check --workspace` for every CI target triple in both dev
// and release profiles: attributes whose items were dead on every target were
// deleted along with the item; attributes whose items are genuinely used (on a
// platform subset, only under `debug_assertions`, only from tests, or from
// macro expansions) were kept and are pinned here per file.
//
// If this test fails because a count went UP: prefer deleting the dead item
// instead of suppressing the lint. If the item is live on another target or
// profile (verify with `cargo check --workspace --target <triple>` and
// `--release`), keep the attribute and update the limits by running
// `bun ./test/internal/source-lints/dead-code-escapes.test.ts`.
//
// If it fails because a count went DOWN: you deleted dead code — update the
// limits the same way so the inventory stays accurate.

import { file } from "bun";
import { sortedInventory, trackedRustSources, withoutLineComments } from "./rust-sources.ts";

// Item-level escapes only: `#[allow(dead_code)]`, combined lists like
// `#[allow(dead_code, non_snake_case)]`, and `#[cfg_attr(<pred>, allow(dead_code))]`
// — including predicates that themselves contain commas, e.g.
// `#[cfg_attr(any(unix, test), allow(dead_code))]` (lazy `[^\]]+?,` backtracks to
// the first comma whose suffix parses as `allow(...)`), attributes that rustfmt
// wrapped across multiple lines (newlines aren't `]`), and trailing meta items
// after the allow, e.g. `#[cfg_attr(test, allow(dead_code), derive(Debug))]`
// (`[^\]]*\]` tail). Neither `[^\]]` class can cross a `]`, so a match is always
// fenced inside a single attribute and cannot span from one `#[...]` to the next.
// Module-level `#![allow(...)]` blocks (codegen surfaces such as
// `runtime/generated_classes.rs` and `jsc/cpp.rs`) are intentionally not counted.
const ESCAPE = /#\[\s*(?:cfg_attr\([^\]]+?,\s*)?allow\([^)]*\bdead_code\b[^)]*\)[^\]]*\]/g;

const limits: Record<string, number> = await Bun.file(import.meta.dir + "/dead-code-escape-limits.json").json();

const counts: Record<string, number> = {};
for (const { source, abs } of trackedRustSources()) {
  // Whole-file scan so rustfmt-wrapped attributes are counted too.
  const n = [...withoutLineComments(await file(abs).text()).matchAll(ESCAPE)].length;
  if (n > 0) counts[source] = n;
}

if (typeof describe === "undefined") {
  // Standalone mode (`bun ./test/internal/source-lints/dead-code-escapes.test.ts`):
  // regenerate the limits file from the current tree.
  const sorted = sortedInventory(counts);
  await Bun.write(import.meta.dir + "/dead-code-escape-limits.json", JSON.stringify(sorted, null, 2) + "\n");
  console.log(`Wrote ${Object.keys(sorted).length} files to dead-code-escape-limits.json`);
  process.exit(0);
}

describe("#[allow(dead_code)] escapes", () => {
  const files = new Set([...Object.keys(limits), ...Object.keys(counts)]);
  for (const source of [...files].sort()) {
    const limit = limits[source] ?? 0;
    const count = counts[source] ?? 0;
    test(`${source} (${limit})`, () => {
      if (count > limit) {
        throw new Error(
          `${source} has ${count} item-level #[allow(dead_code)] escapes, up from ${limit}.\n` +
            `Every escape must hide code that is live on SOME target/profile; dead code must be deleted instead.\n` +
            `Verify with \`cargo check --workspace --target <triple>\` (all CI triples) in dev AND release profiles.\n` +
            `If the new escape is justified, update the inventory with \`bun ./test/internal/source-lints/dead-code-escapes.test.ts\`.`,
        );
      } else if (count < limit) {
        throw new Error(
          `${source} has ${count} item-level #[allow(dead_code)] escapes, down from ${limit}.\n` +
            `Update the inventory with \`bun ./test/internal/source-lints/dead-code-escapes.test.ts\`.`,
        );
      }
    });
  }
});
