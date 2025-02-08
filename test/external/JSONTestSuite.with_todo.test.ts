import { $ } from "bun";
import { test, expect } from "bun:test";
import { readdirSync } from "fs";

const tests_path = import.meta.dirname + "/../node_modules/JSONTestSuite";

const bun_exe = Bun.argv[0];

const json_files: string[] = [
  ...readdirSync(tests_path + "/test_parsing")
    .filter(f => f.endsWith(".json"))
    .map(f => "test_parsing/" + f),
  ...readdirSync(tests_path + "/test_transform")
    .filter(f => f.endsWith(".json"))
    .map(f => "test_transform/" + f),
];

// crashes, don't run the test at all
const crashing = new Set<string>([
  // stack overflows
  "test_parsing/n_structure_100000_opening_arrays.json",
  "test_parsing/n_structure_open_array_object.json",
  "test_parsing/i_structure_500_nested_arrays.json", // probably only fails in debug builds
]);
// fails, expect the test to fail
const failing = new Set<string>([]);
// looser parsing than JSON.parse()
const loose = new Set<string>([
  // trailing junk allowed
  "test_parsing/n_string_with_trailing_garbage.json",
  "test_parsing/n_object_trailing_comma.json",
  "test_parsing/n_structure_object_with_trailing_garbage.json",
  "test_parsing/n_object_lone_continuation_byte_in_key_and_trailing_comma.json",
  "test_parsing/n_object_trailing_comment_slash_open.json",
  "test_parsing/n_object_trailing_comment_open.json",
  "test_parsing/n_object_trailing_comment_slash_open_incomplete.json",
  "test_parsing/n_structure_array_trailing_garbage.json",
  "test_parsing/n_object_trailing_comment.json",

  "test_parsing/n_number_-2..json",
  "test_parsing/n_string_escape_x.json",
  "test_parsing/n_single_space.json",
  "test_parsing/n_number_with_leading_zero.json",
  "test_parsing/n_number_.2e-3.json",
  "test_parsing/n_structure_no_data.json",
  "test_parsing/n_array_number_and_comma.json",
  "test_parsing/n_number_starting_with_dot.json",
  "test_parsing/n_structure_whitespace_formfeed.json",
  "test_parsing/n_number_2.e3.json",
  "test_parsing/n_number_-01.json",
  "test_parsing/n_array_extra_comma.json",
  "test_parsing/n_number_hex_2_digits.json",
  "test_parsing/n_structure_close_unopened_array.json",
  "test_parsing/n_structure_object_with_comment.json",
  "test_parsing/n_number_2.e+3.json",
  "test_parsing/n_structure_double_array.json",
  "test_parsing/n_number_neg_int_starting_with_zero.json",
  "test_parsing/n_number_minus_space_1.json",
  "test_parsing/n_structure_object_followed_by_closing_object.json",
  "test_parsing/n_multidigit_number_then_00.json",
  "test_parsing/n_number_2.e-3.json",
  "test_parsing/n_object_single_quote.json",
  "test_parsing/n_structure_array_with_extra_array_close.json",
  "test_parsing/n_number_neg_real_without_int_part.json",
  "test_parsing/n_string_single_quote.json",
  "test_parsing/n_number_real_without_fractional_part.json",
  "test_parsing/n_array_comma_after_close.json",
  "test_parsing/n_number_0.e1.json",
  "test_parsing/n_array_extra_close.json",
  "test_parsing/n_number_hex_1_digit.json",

  "test_parsing/i_string_UTF-16LE_with_BOM.json",
  "test_parsing/n_structure_UTF8_BOM_no_data.json",
]);

// Different behaviour for `bun test_json.js` and `node test_json.js` (maybe file utf-8 parsing different?):
// - i_string_UTF-8_invalid_sequence.json
// - i_string_invalid_utf-8.json
//

for (const json_file of json_files) {
  const mode = json_file.includes("/i_")
    ? "either"
    : json_file.includes("/n_")
      ? "fail"
      : json_file.includes("/y_")
        ? "parse"
        : json_file.includes("test_transform/")
          ? "parse"
          : "never";
  const testfn = crashing.has(json_file) ? test.skip : failing.has(json_file) ? test.todo : test;
  const is_loose = loose.has(json_file);
  const json_path = tests_path + "/" + json_file;
  testfn(json_file, async () => {
    const build_res = await Bun.build({
      entrypoints: [json_path],
    });
    if (!build_res.success) {
      if (mode === "either" || mode === "fail") {
        return;
      }
      console.error(build_res.logs.join("\n"));
      expect(false).toBe(true);
      return;
    }
    if (build_res.outputs.length !== 1) {
      throw new Error("wrong number of build outputs");
    }

    const [output] = build_res.outputs;
    const output_txt = await output.text();

    // hack to remove esm
    const match_result = output_txt.match(/^(.+)\nexport {(?:.+?,)?\n  ([^,]+?) as default(?:,\n.+?)?\n};\n$/s);
    if (match_result == null) {
      console.error("EXPECTED:");
      console.log(output_txt);
      throw new Error("match result did not match");
    }
    const [, rescode, resname] = match_result;

    const match_json = match_result[1];
    const match_json_value = new Function("", rescode + "\nreturn " + resname)();

    const src_file_cont = await Bun.file(json_path).arrayBuffer();
    const src_file_dec = new TextDecoder().decode(src_file_cont);
    let src_file_decoded;
    try {
      src_file_decoded = JSON.parse(src_file_dec);
    } catch (e) {
      // original file failed to parse, but bun succeeded to parse. exit(0) because that means bun parsed succesfully
      if (is_loose) return;
      throw new Error("Succeeded to parse with Bun, but failed to parse with JSON.parse");
    }

    expect(match_json_value).toStrictEqual(src_file_decoded);
  });
}
