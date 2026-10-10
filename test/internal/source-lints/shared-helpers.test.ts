// A helper on text, paths or hashes is written once, in a shared crate.
//
// clippy cannot see a reimplementation: `trim` was defined seven times, `push_code_point` six, and there were two whole
// private modules for paths beside `bun_paths`. Each copy is compiled, tested (or not) and repaired by itself, and the
// copies drift: one `trim` takes JavaScript's white space, the next ASCII's.
//
// This lint knows the NAMES that such helpers have (`FAMILIES`), and finds the free functions with one of these names
// outside the shared crates (`SHARED`): no `self`, and the first parameter is text, a byte, a code unit or a code point.
// A method that happens to be called `contains` or `join` is not one, nor a function of a type (`SveltePart::order`).
//
// What was there when the lint was written is in shared-helpers.inventory.json, by file and name. It can only shrink.
//
// If this fails because you ADDED one: use the function that the message names. If Bun has none, write it in the shared
// crate that the message names, in that crate's idiom, named for what is particular about it (`trim_js_white_space`,
// not `trim`), and call it from there. The inventory does not take it: `--update` leaves out what grows.
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
  "src/node_path/",
  "src/text_diff/",
  // `bun_node_path` for the paths of the linter and the formatter, which have `/` on every system.
  "src/lint/paths.rs",
];

/** The names, and what to use in their place: functions of the shared crates, and a word on what they lack. */
const FAMILIES: [family: string, names: string, use: string, note?: string][] = [
  [
    "white space and lines",
    "trim trim_start trim_end trim_left trim_right is_blank is_space is_whitespace is_white_space white_space_len skip_blanks skip_spaces skip_whitespace skip_white_space is_line_terminator is_line_break has_line_break lines split_lines line_starts space_len space_len_back white_space_len_back white_space_run leading_white_space_len leading_whitespace_count trailing_whitespace_count is_html_whitespace is_html_white_space html_trim html_trim_start html_trim_end trim_html_whitespace_start trim_html_whitespace_end has_white_space has_html_whitespace has_html_white_space starts_with_white_space ends_with_white_space without_blanks without_spaces remove_spaces leading_blanks is_space_or_tab is_unicode_whitespace is_unicode_blank is_white_space_like is_jsx_whitespace trim_bytes split_whitespace line_break_len line_terminator_len line_terminator_len_back find_line_break has_newline has_line_terminator has_linebreak skip_newline skip_newline_backwards without_line_break count_line_breaks count_new_lines line_breaks normalize_line_breaks normalize_end_of_line push_with_normalized_newlines line_end line_start without_last_line find_line_end count_spaces without_spaces_at_end without_line_breaks_at_start len_without_line_end find_ascii_whitespace",
    "bun_core::strings::{trim, trim_left, trim_right, is_whitespace, starts_with_line_break, split, trim_js_whitespace, trim_js_whitespace_start, trim_js_whitespace_end, is_all_js_whitespace, is_js_whitespace, js_whitespace_len, js_whitespace_len_back, without_js_whitespace, trim_unicode_whitespace, trim_unicode_whitespace_start, trim_unicode_whitespace_end, is_all_unicode_whitespace, split_unicode_whitespace, is_js_line_terminator, js_line_break_len, js_line_break_len_back, find_js_line_break, contains_js_line_break, js_lines, split_crlf_lines, crlf_as_lf, push_crlf_as_lf, is_white_space_like, is_white_space_single_line}",
    "one function for each SET of white space, named for the set: `js` is `\\s` of a regular expression, `unicode` is White_Space, which Rust's `str::trim` goes by; HTML's and CSS's five bytes are std's `trim_ascii*` and `u8::is_ascii_whitespace`",
  ],
  [
    "UTF-8, UTF-16, code points",
    "push_code_point push_codepoint encode_code_point encode_utf8 utf16_len utf8_len utf16_length utf8_length to_utf16 from_utf16 to_utf8 utf16_index byte_offset code_point_at code_point_len decode_code_point bom_len strip_bom without_bom len_utf16 count_units units_to_bytes offset_of_utf16_index utf16_offset_to_byte code_points code_points_of first_char last_char decode_last multibyte_at char_len push_char push_utf16 push_well_formed to_well_formed has_surrogate lead_surrogate trail_surrogate is_lead_surrogate is_trail_surrogate combine_surrogate_pair is_surrogate_pair",
    "bun_core::strings::{push_codepoint_wtf8, push_codepoint_wtf8_joined, push_wtf8, push_wtf8_well_formed, wtf8_has_surrogate, wtf8_codepoint_at, wtf8_codepoints, wtf8_first_codepoint, wtf8_codepoint_count, codepoint_len_utf16, wtf8_len_utf16, utf8_lossy_len_utf16, wtf8_offset_of_utf16_index, wtf8_slice_by_utf16, wtf8_to_utf16, wtf16_to_wtf8, encode_wtf8_rune, push_codepoint_utf16, decode_wtf8_rune_t, wtf8_byte_sequence_length, element_length_utf8_into_utf16, element_length_utf16_into_utf8, to_utf16_alloc, to_utf8_alloc, to_utf8_append_to_list, without_utf8_bom}",
  ],
  [
    "identifiers",
    "is_identifier is_identifier_start is_identifier_part is_identifier_continue is_valid_identifier is_id_start is_id_continue is_identifier_name is_valid_js_identifier is_identifier_byte is_name_byte is_word_character is_regex_word is_regex_word_byte is_es5_identifier_name",
    "bun_core::strings::{is_identifier, is_identifier_start, is_identifier_part, is_identifier_utf16, is_regexp_word_byte}",
  ],
  [
    "width of text",
    "string_width visible_width display_width char_width code_point_width str_width",
    "bun_core::strings::{visible_width_exclude_ansi_colors}",
    "what Bun.stringWidth uses",
  ],
  [
    "paths",
    "is_absolute dirname basename extension extname relative normalize join resolve file_name parent ancestors device_len directory_of file_extension extension_of_path from_native to_native is_file_path display_path",
    "bun_node_path::{resolve_posix_t, relative_posix_t, dirname_posix_t, basename_posix_t, extname_posix_t, is_absolute_posix_t, join_posix_t, normalize_posix_t}",
    "node:path's algorithms, and their `_windows_t`; in the linter: bun_lint::paths, which is on them. bun_paths' own take `\\` for a separator and keep a `/` at the end",
  ],
  [
    "comparison",
    "compare locale_compare natural_compare order eq_ignore_case eql_ignore_case equals_ignore_case eq_ignore_ascii_case cmp_ignore_case is_less_than collator_compare collate_base_numeric collation_key primary_weight cmp_ascii_case_insensitive natural_sort natord collation_element",
    "bun_core::strings::{order, order_utf16, locale_compare, locale_compare_numeric_base, cmp_strings_asc, eql, eql_long, eql_case_insensitive_ascii, has_prefix_case_insensitive}",
  ],
  [
    "search and split",
    "index_of last_index_of contains starts_with ends_with split split_once replace replace_all count strip_prefix strip_suffix includes index_of_from index_of_char_from index_from without_hash trim_backticks",
    "bun_core::strings::{index_of, index_of_char, index_of_any, last_index_of, contains, contains_char, starts_with, ends_with, has_prefix, split, split_once, split_any, replace, count_char, without_prefix}",
  ],
  [
    "escaping and quoting",
    "escape unescape quote quoted write_string write_json_string json_string escape_html escape_regex escape_reg_exp escape_source escape_regex_source escaped_source json_stringify write_xml_escaped write_escaped push_escaped without_unicode_escapes",
    "bun_core::{json_stringify, json_stringify_alloc, write_json_string, quote_for_json, quote, escape_reg_exp, xml_escape_entity, html_escape_entity}",
  ],
  [
    "case",
    "to_lower to_lowercase to_upper to_uppercase kebab_case camel_case pascal_case snake_case capitalize to_lower_case to_upper_case lowercase push_lowercase cow_to_ascii_lowercase eq_lower_case starts_with_upper starts_with_uppercase starts_with_upper_case is_upper_case is_lower_case is_uppercase is_lowercase",
    "bun_core::strings::{copy_lowercase, copy_lowercase_if_needed, eql_case_insensitive_ascii}",
  ],
  [
    "hashes",
    "hash hash_bytes hash_with_seed string_hash hash_string hash_of_str ident_hash hash_of",
    "bun_wyhash::{hash, hash_with_seed, hash_const}",
  ],
  [
    "numbers and digits",
    "to_number number_to_string parse_float parse_int parse_decimal is_digit is_hex_digit hex_value hex_digit unhex string_to_number decimal_literal_len decimal_digits to_precision array_index as_array_index is_array_index parse_number parse_integer parse_index digit_to_int hex_code hex4 push_hex write_f64 write_js_number format_js_number exact_digits round_digits to_fixed to_exponential integer_value decimal_value",
    "bun_core::fmt::{js_string_to_number, js_decimal_literal_len, parse_f64, to_fixed, to_precision, to_exponential, dtoa, parse_decimal, parse_int, hex_digit_value, hex_digit_value_u32, hex_pair_value, parse_hex4, parse_hex_prefix, hex_byte_upper, hex_byte_lower, hex_lower, bytes_to_hex_lower_string}",
  ],
  [
    "Base64, hex, percent",
    "base64_encode base64_decode hex_encode hex_decode percent_encode percent_decode url_decode url_encode decode_uri_component encode_uri decode_uri encode_uri_component",
    "bun_core::strings::{decode_hex_to_bytes, percent_encode_write}",
    "and bun_base64",
  ],
  [
    "edit distance",
    "levenshtein edit_distance damerau_levenshtein min_edit_distance",
    "bun_core::strings::{edit_distance}",
  ],
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

/** Whether what is at `index` is in an `impl` or a `trait`: `SveltePart::order(value)` is no comparison of strings. By rustfmt's indentation. */
function isAssociated(text: string, index: number): boolean {
  const start = text.lastIndexOf("\n", index) + 1;
  const indentation = /^ */.exec(text.slice(start, index))![0].length;
  if (indentation === 0) return false;
  // The nearest line above that is indented less opens the block.
  const above = text.slice(0, start).split("\n");
  for (let at = above.length - 1; at >= 0; at--) {
    const line = above[at];
    if (line.trim() === "" || /^ */.exec(line)![0].length >= indentation) continue;
    return (
      /^\s*(?:pub(?:\([^)]*\))?\s+)?(?:unsafe\s+)?(?:impl|trait)\b/.test(line) ||
      /^\s*(?:where\b|[A-Z]\w*\s*:)/.test(line)
    );
  }
  return false;
}

type Inventory = Record<string, Record<string, number>>;
/** `reserved`: the names at the time. A name that is reserved later brings what has it. */
type Kept = { reserved: string[]; files: Inventory };
const found: Inventory = {};
const shared = new Set<string>();
let scanned = 0;

for (const abs of globAllSources().rust.filter(p => p.endsWith(".rs"))) {
  const source = path.relative(root, abs).replaceAll(path.sep, "/");
  if (path.relative(root, realpathSync(abs)).replaceAll(path.sep, "/") !== source) continue;
  scanned++;
  const stripped = (await file(abs).text()).replace(/^\s*\/\/.*$/gm, "");
  if (SHARED.some(it => source.startsWith(it))) {
    for (const [, name] of stripped.matchAll(/\bfn\s+([a-z_][a-z0-9_]*)/g)) shared.add(name);
    continue;
  }
  for (const match of stripped.matchAll(FUNCTION)) {
    const [, name, first, type] = match;
    if (first === "self" || !familyOf.has(name) || !TEXT.test(type.trim())) continue;
    if (isAssociated(stripped, match.index)) continue;
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

if (process.argv.includes("--added")) {
  // For a script: file, name, what to use. A tab between them.
  const { files }: Kept = await Bun.file(INVENTORY).json();
  for (const [source, names] of Object.entries(normalized)) {
    for (const [name, count] of Object.entries(names)) {
      if (count > (files[source]?.[name] ?? 0)) console.log([source, name, familyOf.get(name)!.use].join("\t"));
    }
  }
  process.exit(0);
}

if (process.argv.includes("--update")) {
  // A file can be moved or split. No name can be defined more often than before: of such a name the inventory stays as
  // it is, so that one who has removed copies does not wait for a stranger who has added one.
  const before: Kept | null = await Bun.file(INVENTORY)
    .json()
    .catch(() => null);
  const [was, is] = [totals(before?.files ?? {}), totals(normalized)];
  const grown = Object.keys(is).filter(name => before?.reserved.includes(name) && is[name] > (was[name] ?? 0));
  const files: Inventory = {};
  for (const [from, isTaken] of [
    [normalized, (name: string) => !grown.includes(name)],
    [before?.files ?? {}, (name: string) => grown.includes(name)],
  ] as const) {
    for (const [source, names] of Object.entries(from)) {
      for (const [name, count] of Object.entries(names)) if (isTaken(name)) (files[source] ??= {})[name] = count;
    }
  }
  const sorted = sortKeys(Object.fromEntries(Object.entries(files).map(([k, v]) => [k, sortKeys(v)])));
  const kept: Kept = { reserved: [...familyOf.keys()].sort(), files: sorted };
  await Bun.write(INVENTORY, JSON.stringify(kept, null, 2) + "\n");
  console.log(`Wrote ${Object.keys(sorted).length} files to ${path.basename(INVENTORY)}`);
  for (const name of grown) {
    console.error(
      `NOT ${name}: ${was[name] ?? 0} -> ${is[name]}: the inventory only shrinks. Use ${familyOf.get(name)!.use}`,
    );
  }
  process.exit(grown.length > 0 ? 1 : 0);
}

const { reserved, files: inventory }: Kept = await Bun.file(INVENTORY).json();

describe("helpers on text, paths and hashes are shared", () => {
  test("the sources are found", () => {
    // Guard against a root that resolves wrong, which would make the rest pass vacuously.
    expect(scanned).toBeGreaterThan(2000);
  });

  test("the inventory is of these names", () => {
    // After a name is added to FAMILIES: --update.
    expect(reserved).toEqual([...familyOf.keys()].sort());
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
