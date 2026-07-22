// Guards against reintroduction of previously-removed dead `pub` items.
//
// The workspace compiles with `dead_code = "deny"` and `unreachable_pub =
// "deny"`, so rustc already catches unreachable private items. What slips
// through are `pub` items re-exported at a crate root: they're reachable, so
// the lint is satisfied, but nothing in any other crate ever calls them. Each
// entry below was verified to have zero references anywhere in `src/`,
// `build/debug/codegen/`, or `src/codegen/` (beyond its own definition and
// re-export) before being deleted. Pinning the absence here stops a merge-era
// revert or copy-paste from quietly bringing one back.
//
// To add an entry after removing a dead symbol: append `{ file, pattern }`
// where `pattern` matches the definition line and nothing else in that file.

import { file } from "bun";
import { expect, test } from "bun:test";
import path from "node:path";

const root = path.resolve(import.meta.dir, "..", "..", "..");

const removed: { file: string; pattern: RegExp; name: string }[] = [
  {
    file: "src/options_types/jsx.rs",
    pattern: /\bpub fn parse_package_name\b/,
    name: "jsx::Pragma::parse_package_name",
  },
  {
    file: "src/options_types/bundle_enums.rs",
    pattern: /\bpub trait LoaderOptionalExt\b/,
    name: "bundle_enums::LoaderOptionalExt",
  },
  {
    file: "src/options_types/bundle_enums.rs",
    pattern: /\bpub trait ImportKindExt\b/,
    name: "bundle_enums::ImportKindExt",
  },
  {
    file: "src/options_types/schema.rs",
    pattern: /\bpub enum ImportKind\b/,
    name: "schema::api::ImportKind",
  },
  {
    file: "src/options_types/lib.rs",
    pattern: /\bBASE_PUBLIC_PATH_WITH_DEFAULT_SUFFIX\b/,
    name: "standalone_path::BASE_PUBLIC_PATH_WITH_DEFAULT_SUFFIX (duplicate of bun_standalone_graph's)",
  },
  {
    file: "src/http_types/mime_type_list_enum.rs",
    pattern: /\bpub const COUNT\b/,
    name: "MimeTypeList::COUNT",
  },
  {
    file: "src/http_types/Method.rs",
    pattern: /\bpub fn contains\(&self, other: &Optional\)/,
    name: "Method::Optional::contains",
  },
  {
    file: "src/ast/loader.rs",
    pattern: /\bpub struct LoaderOptional\b/,
    name: "bun_ast::LoaderOptional",
  },
];

for (const { file: rel, pattern, name } of removed) {
  test(`${name} stays removed from ${rel}`, async () => {
    const abs = path.join(root, rel);
    const content = await file(abs).text();
    const lines = content.split("\n");
    const hits: string[] = [];
    for (let i = 0; i < lines.length; i++) {
      if (pattern.test(lines[i])) hits.push(`${rel}:${i + 1}: ${lines[i].trim()}`);
    }
    if (hits.length > 0) {
      throw new Error(
        `${name} was previously removed as dead code (zero workspace references) ` +
          `but is present again in ${rel}:\n` +
          hits.map(h => `  ${h}`).join("\n") +
          `\nIf this symbol now has a real caller, delete its entry from ` +
          `test/internal/source-lints/removed-dead-symbols.test.ts. Otherwise, ` +
          `remove the dead definition.`,
      );
    }
    expect(hits).toEqual([]);
  });
}
