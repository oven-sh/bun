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
// `bun ./test/internal/source-lints/dead-code-escapes.test.ts --update`.
//
// If it fails because a count went DOWN: you deleted dead code — update the
// limits the same way so the inventory stays accurate.

import { describe, expect, test } from "bun:test";
import path from "node:path";
import {
  metaItemPaths,
  parseRust,
  type Attribute,
  type Meta,
  type RustFile,
} from "../../../scripts/rust-parser/index.ts";
import { rustSources } from "./rust-sources.ts";

// Item-level escapes only: every outer `#[...]` attribute whose meta is an
// `allow(...)` list naming `dead_code` (`#[allow(dead_code)]`, combined lists
// like `#[allow(dead_code, non_snake_case)]`), or a `cfg_attr(<pred>, ...)`
// wrapper carrying such a list among the attributes after its predicate
// (`#[cfg_attr(any(unix, test), allow(dead_code))]`,
// `#[cfg_attr(test, allow(dead_code), derive(Debug))]`, nested `cfg_attr`s).
// The query works on the parsed attribute, so rustfmt wrapping, spacing, and
// the order of the meta items do not matter, and prose in comments or string
// literals is never counted. Attributes are visited wherever they are written:
// on items, fields, variants, params, statements, match arms, and expressions,
// and also inside `macro_rules!` bodies and `quote! { }` templates (where the
// escape lands on the expanded item).
//
// Module-level `#![allow(...)]` blocks (codegen surfaces such as
// `runtime/generated_classes.rs` and `jsc/cpp.rs`) are intentionally not
// counted.
function allowsDeadCode(meta: Meta): boolean {
  if (meta.kind !== "MetaList") return false;
  if (meta.path === "allow") return metaItemPaths(meta).includes("dead_code");
  if (meta.path === "cfg_attr") return meta.items.slice(1).some(allowsDeadCode);
  return false;
}

function findDeadCodeEscapes(file: RustFile): Attribute[] {
  return file.allAttributes().filter(attr => attr.style === "outer" && allowsDeadCode(attr.meta));
}

const LIMITS_PATH = path.join(import.meta.dir, "dead-code-escape-limits.json");

const sources = rustSources();
const counts: Record<string, number> = {};
for (const src of sources) {
  const n = findDeadCodeEscapes(src.file).length;
  if (n > 0) counts[src.path] = n;
}

if (process.argv.includes("--update")) {
  // Standalone mode (`bun ./test/internal/source-lints/dead-code-escapes.test.ts --update`):
  // regenerate the limits file from the current tree.
  const sorted = Object.fromEntries(Object.entries(counts).sort(([a], [b]) => (a < b ? -1 : 1)));
  await Bun.write(LIMITS_PATH, JSON.stringify(sorted, null, 2) + "\n");
  console.log(`Wrote ${Object.keys(sorted).length} files to dead-code-escape-limits.json`);
  process.exit(0);
}

const limits: Record<string, number> = await Bun.file(LIMITS_PATH).json();

test("scans a non-empty set of tracked Rust sources", () => {
  expect(sources.length).toBeGreaterThan(0);
});

test("the query recognizes the attribute spellings it claims to", () => {
  const count = (snippet: string) => findDeadCodeEscapes(parseRust(snippet)).length;
  const counted = [
    "#[allow(dead_code)]\nstruct A;",
    "#[allow(dead_code, non_snake_case)]\nstruct A;",
    "#[cfg_attr(any(unix, test), allow(dead_code))]\nstruct A;",
    "#[cfg_attr(test, allow(dead_code), derive(Debug))]\nstruct A;",
    // rustfmt-wrapped.
    "#[cfg_attr(\n    windows,\n    allow(dead_code)\n)]\nstruct A;",
    // Not only items: fields and statements carry escapes too.
    "struct A {\n    #[allow(dead_code)]\n    x: u8,\n}",
    "fn f() {\n    #[allow(dead_code)]\n    let x = 1;\n}",
    // Spelling the old text match missed.
    "#[allow (dead_code)]\nstruct A;",
    // Macro templates: the escape lands on the expanded item.
    "macro_rules! m { () => { #[allow(dead_code)] struct Q; } }",
    "fn f() -> TokenStream { quote! { #[allow(dead_code)] struct Q; } }",
  ];
  const notCounted = [
    // Module-level blocks are a separate population.
    "#![allow(dead_code)]\nstruct A;",
    "fn f() {\n    #![allow(dead_code)]\n}",
    "#[allow(unused)]\nstruct A;",
    "#[deny(dead_code)]\nstruct A;",
    // An `allow` list nested under anything but `cfg_attr` is an argument of
    // that attribute, not an `allow` attribute.
    "#[cfg_attr(test, foo(allow(dead_code)))]\nstruct A;",
    // Prose about the attribute is not the attribute.
    "// #[allow(dead_code)]\nstruct A;",
    'const S: &str = "#[allow(dead_code)]";',
  ];
  expect(counted.map(count)).toEqual(counted.map(() => 1));
  expect(notCounted.map(count)).toEqual(notCounted.map(() => 0));
});

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
            `If the new escape is justified, update the inventory with \`bun ./test/internal/source-lints/dead-code-escapes.test.ts --update\`.`,
        );
      } else if (count < limit) {
        throw new Error(
          `${source} has ${count} item-level #[allow(dead_code)] escapes, down from ${limit}.\n` +
            `Update the inventory with \`bun ./test/internal/source-lints/dead-code-escapes.test.ts --update\`.`,
        );
      }
    });
  }
});
