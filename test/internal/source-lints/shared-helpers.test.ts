// A helper on text, paths or hashes is written once, in a shared crate.
//
// clippy cannot see a reimplementation: `trim` was defined seven times, `push_code_point` six, and there were two whole
// private modules for paths beside `bun_paths`. Each copy is compiled, tested (or not) and repaired by itself, and the
// copies drift: one `trim` takes JavaScript's white space, the next ASCII's.
//
// This lint knows the NAMES that such helpers have (`FAMILIES`), and finds the free functions with one of these names
// outside the shared crates (`SHARED`): no `self`, and the first parameter is text, a byte, a code unit or a code point.
// A method that happens to be called `contains` or `join` is not one.
//
// What was there when the lint was written is in shared-helpers.inventory.json, by file and name. It can only shrink.
//
// If this fails because you ADDED one: use the function that the message names. If Bun has none, write it in the shared
// crate that the message names, in that crate's idiom, named for what is particular about it (`trim_js_white_space`,
// not `trim`), and call it from there. The inventory does not take it: `--update` refuses what grows.
// If it fails because you REMOVED or MOVED one:
//   bun ./test/internal/source-lints/shared-helpers.test.ts --update

import { file } from "bun";
import { describe, expect, test } from "bun:test";
import { realpathSync } from "fs";
import path from "path";
import { globAllSources } from "../../../scripts/glob-sources.ts";

const root = path.resolve(import.meta.dir, "..", "..", "..");
const INVENTORY = import.meta.dir + "/shared-helpers.inventory.json";

/** Where such a function belongs. */
const SHARED = [
  "src/bun_core/",
  "src/paths/",
  "src/collections/",
  "src/sys/",
  "src/wyhash/",
  "src/base64/",
  "src/bun_alloc/",
];

/** The names, and what to use in their place: functions of the shared crates, and a word on what they lack. */
const FAMILIES: [family: string, names: string, use: string, note?: string][] = [
  [
    "white space and lines",
    "trim trim_start trim_end trim_left trim_right is_blank is_space is_whitespace is_white_space white_space_len skip_blanks skip_spaces skip_whitespace skip_white_space is_line_terminator is_line_break has_line_break lines split_lines line_starts",
    "bun_core::strings::{trim, trim_left, trim_right, is_whitespace, starts_with_line_break, split}",
    "one function for each SET of white space, named for the set",
  ],
  [
    "UTF-8, UTF-16, code points",
    "push_code_point push_codepoint encode_code_point encode_utf8 utf16_len utf8_len utf16_length utf8_length to_utf16 from_utf16 to_utf8 utf16_index byte_offset code_point_at code_point_len decode_code_point bom_len strip_bom without_bom",
    "bun_core::strings::{encode_wtf8_rune, push_codepoint_utf16, decode_wtf8_rune_t, wtf8_byte_sequence_length, element_length_utf8_into_utf16, element_length_utf16_into_utf8, to_utf16_alloc, to_utf8_alloc, without_utf8_bom}",
  ],
  [
    "identifiers",
    "is_identifier is_identifier_start is_identifier_part is_identifier_continue is_valid_identifier is_id_start is_id_continue is_identifier_name",
    "bun_core::strings::{is_identifier, is_identifier_start, is_identifier_part, is_identifier_utf16}",
  ],
  [
    "width of text",
    "string_width visible_width display_width char_width code_point_width",
    "bun_core::strings::{visible_width_exclude_ansi_colors}",
    "what Bun.stringWidth uses",
  ],
  [
    "paths",
    "is_absolute dirname basename extension extname relative normalize join resolve file_name parent ancestors",
    "bun_paths::{is_absolute, dirname, basename, extension, join, relative, normalize_string, resolve}",
    "and Path<..>",
  ],
  [
    "comparison",
    "compare locale_compare natural_compare order eq_ignore_case eql_ignore_case equals_ignore_case eq_ignore_ascii_case cmp_ignore_case",
    "bun_core::strings::{order, cmp_strings_asc, eql, eql_long, eql_case_insensitive_ascii, has_prefix_case_insensitive}",
  ],
  [
    "search and split",
    "index_of last_index_of contains starts_with ends_with split split_once replace replace_all count strip_prefix strip_suffix",
    "bun_core::strings::{index_of, index_of_char, index_of_any, last_index_of, contains, contains_char, starts_with, ends_with, has_prefix, split, split_once, split_any, replace, count_char, without_prefix}",
  ],
  [
    "escaping and quoting",
    "escape unescape quote quoted write_string write_json_string json_string escape_html escape_regex escape_reg_exp",
    "bun_core::{write_json_string, quote_for_json, quote, escape_reg_exp}",
  ],
  [
    "case",
    "to_lower to_lowercase to_upper to_uppercase kebab_case camel_case pascal_case snake_case capitalize",
    "bun_core::strings::{copy_lowercase, copy_lowercase_if_needed, eql_case_insensitive_ascii}",
  ],
  ["hashes", "hash hash_bytes hash_with_seed string_hash hash_string", "bun_wyhash::{hash, hash_with_seed}"],
  [
    "numbers and digits",
    "to_number number_to_string parse_float parse_int parse_decimal is_digit is_hex_digit hex_value hex_digit unhex",
    "bun_core::{parse_decimal, parse_int, hex_digit_value, hex_pair_value, decode_hex_to_bytes}",
  ],
  [
    "Base64, hex, percent",
    "base64_encode base64_decode hex_encode hex_decode percent_encode percent_decode url_decode url_encode",
    "bun_core::strings::{decode_hex_to_bytes, percent_encode_write}",
    "and bun_base64",
  ],
  ["edit distance", "levenshtein edit_distance damerau_levenshtein", "bun_core::strings::{}", "Bun has none there yet"],
];
const familyOf = new Map(
  FAMILIES.flatMap(([family, names, use, note]) =>
    names.split(" ").map(it => [it, { family, use: note ? `${use} (${note})` : use }]),
  ),
);

// `fn name<..>(first: Type`. A receiver has no `:` after `self`, or is called `self`.
const FUNCTION = /\bfn\s+([a-z_][a-z0-9_]*)\s*(?:<[^(]*?>)?\s*\(\s*(?:mut\s+)?([a-z_][a-z0-9_]*)\s*:\s*([^,)]+)/g;
const TEXT =
  /^(?:&(?:'\w+\s+)?(?:mut\s+)?(?:\[u8\]|\[u16\]|str|BStr|Vec<u8>|Vec<u16>|String)|u8|u16|u32|i32|char|CodePoint|impl AsRef<\[u8\]>)$/;

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

type Inventory = Record<string, Record<string, number>>;
const found: Inventory = {};
const shared = new Set<string>();
let scanned = 0;

for (const abs of globAllSources().rust.filter(p => p.endsWith(".rs"))) {
  const source = path.relative(root, abs).replaceAll(path.sep, "/");
  if (path.relative(root, realpathSync(abs)).replaceAll(path.sep, "/") !== source) continue;
  if (tracked !== null && !tracked.has(source)) continue;
  scanned++;
  const stripped = (await file(abs).text()).replace(/^\s*\/\/.*$/gm, "");
  if (SHARED.some(it => source.startsWith(it))) {
    for (const [, name] of stripped.matchAll(/\bfn\s+([a-z_][a-z0-9_]*)/g)) shared.add(name);
    continue;
  }
  for (const [, name, first, type] of stripped.matchAll(FUNCTION)) {
    if (first === "self" || !familyOf.has(name) || !TEXT.test(type.trim())) continue;
    const entry = (found[source] ??= {});
    entry[name] = (entry[name] ?? 0) + 1;
  }
}

const sortKeys = <T>(o: Record<string, T>): Record<string, T> =>
  Object.fromEntries(Object.entries(o).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)));
const normalized: Inventory = sortKeys(Object.fromEntries(Object.entries(found).map(([k, v]) => [k, sortKeys(v)])));

const totals = (inventory: Inventory) => {
  const all: Record<string, number> = {};
  for (const names of Object.values(inventory)) {
    for (const [name, count] of Object.entries(names)) all[name] = (all[name] ?? 0) + count;
  }
  return all;
};

if (process.argv.includes("--families")) {
  const all = totals(normalized);
  for (const [family, names] of FAMILIES) {
    const here = names.split(" ").filter(it => all[it]);
    const sum = here.reduce((sum, it) => sum + all[it], 0);
    console.log(`${String(sum).padStart(4)}  ${family}: ${here.map(it => `${it} ${all[it]}`).join(", ")}`);
  }
  process.exit(0);
}

if (process.argv.includes("--update")) {
  // A file can be moved or split. No name can be defined more often than before.
  const before: Inventory | null = await Bun.file(INVENTORY)
    .json()
    .catch(() => null);
  if (before !== null) {
    const [was, is] = [totals(before), totals(normalized)];
    const grown = Object.keys(is).filter(name => is[name] > (was[name] ?? 0));
    if (grown.length > 0) {
      for (const name of grown) {
        console.error(`${name}: ${was[name] ?? 0} -> ${is[name]}. Use ${familyOf.get(name)!.use}`);
      }
      console.error("The inventory only shrinks: not written.");
      process.exit(1);
    }
  }
  await Bun.write(INVENTORY, JSON.stringify(normalized, null, 2) + "\n");
  console.log(`Wrote ${Object.keys(normalized).length} files to ${path.basename(INVENTORY)}`);
  process.exit(0);
}

const inventory: Inventory = await Bun.file(INVENTORY).json();

describe("helpers on text, paths and hashes are shared", () => {
  test("the sources are found", () => {
    // Guard against a root that resolves wrong, which would make the rest pass vacuously.
    expect(scanned).toBeGreaterThan(2000);
  });

  test("what the messages name is there", () => {
    const named = FAMILIES.flatMap(([, , use]) => /\{(.*)\}/.exec(use)![1].split(", ").filter(Boolean));
    expect(named.filter(it => !shared.has(it))).toEqual([]);
  });

  const files = [...new Set([...Object.keys(inventory), ...Object.keys(normalized)])].sort();
  test.each(files)("%s", source => {
    const expected = inventory[source] ?? {};
    const actual = normalized[source] ?? {};
    const added = Object.keys(actual).filter(name => actual[name] > (expected[name] ?? 0));
    if (added.length > 0) {
      throw new Error(
        added
          .map(
            name =>
              `${source}: a new \`fn ${name}\` (${familyOf.get(name)!.family}). It is written once, in a shared crate. ` +
              `Use ${familyOf.get(name)!.use}.`,
          )
          .join("\n"),
      );
    }
    if (!Bun.deepEquals(actual, expected)) {
      throw new Error(
        `${source}: fewer private helpers than the inventory has. Good.\n` +
          `  expected: ${JSON.stringify(expected)}\n` +
          `  actual:   ${JSON.stringify(actual)}\n` +
          `Regenerate: bun ./test/internal/source-lints/shared-helpers.test.ts --update`,
      );
    }
  });
});
