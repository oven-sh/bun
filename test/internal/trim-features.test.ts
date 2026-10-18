import { expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { declarationsOf, declarationsPath, doorsPath, readTrimFeatures, removedOnlyWith } from "../../scripts/build/trim-features";

const doors = readFileSync(doorsPath, "utf8");
const all = readTrimFeatures(doors);
const features = doors
  .split("\n")
  .filter(line => line.startsWith("feature "))
  .map(line => line.split(" ")[1]);

test("packages/bun-types/trim.d.ts is what scripts/build/trim-features.ts makes of scripts/build/islands.doors", () => {
  expect(readFileSync(declarationsPath, "utf8"), "Run: bun scripts/build/trim-features.ts").toBe(declarationsOf(doors));
});

test("every public name is spelled like an option, stands once, and says what it is and what it saves", () => {
  const names = all.names.map(each => each.name);
  expect(names.filter(name => !/^[a-z][a-z0-9]*(-[a-z0-9]+)*$/.test(name))).toEqual([]);
  expect(names).toEqual([...new Set(names)]);
  expect(all.names.filter(each => !each.about.endsWith(".")).map(each => each.name)).toEqual([]);
  expect(all.names.filter(each => !each.saves || Number.isNaN(each.saves.linux + each.saves.macos)).map(each => each.name)).toEqual([]);
});

test("the writer knows every kind of condition in the table; a kind it does not know keeps its feature in every executable", () => {
  const writer = readFileSync(join(import.meta.dir, "../../src/exe_islands/lib.rs"), "utf8");
  const known = ["KINDS_OF_FACTS", "KINDS_LISTED_BY_THE_COMPILER"].flatMap(list => [...writer.match(new RegExp(`const ${list}: [^=]*= \\[(.*)\\];`))![1].matchAll(/b"([^"]+)"/g)].map(match => match[1]));
  const kinds = new Set(doors.split("\n").filter(line => line.startsWith("when ")).map(line => line.split(" ")[2]));
  expect([...kinds].filter(kind => kind !== "feature" && !known.includes(kind))).toEqual([]);
});

test("public names and libraries are made of features", () => {
  const named = [...all.names.flatMap(each => [...each.features, ...each.also.map(also => also.feature)]), ...all.libraries.flatMap(library => library.features)];
  expect(named.filter(feature => !features.includes(feature))).toEqual([]);
  expect(all.names.filter(each => each.features.length === 0).map(each => each.name)).toEqual([]);
});

test("whatever needs a public name has a public name of its own, or the name says what of it stops working", () => {
  expect(all.names.flatMap(each => removedOnlyWith(all, each).filter(name => name.startsWith("(")).map(name => `${each.name} is needed by ${name}`))).toEqual([]);
});

test("a line that says what else stops working stands for a feature that does need the name", () => {
  const idle = all.names.flatMap(each =>
    each.also.filter(also => !all.needs.some(({ needed, dependent }) => each.features.includes(needed) && dependent === also.feature)).map(also => `${each.name} ${also.feature}`),
  );
  expect(idle).toEqual([]);
});

test("what is undefined or throws once a name is removed is a way into one of its features that the link knows", () => {
  const owners: Record<string, string> = { Bun: "Bun", Intl: "Intl", process: "process", console: "console" };
  const known = new Set(doors.split("\n").flatMap(line => (line.startsWith("when ") ? [line.split(" ").slice(1).join(" ")] : [])));
  const unknown = all.names.flatMap(each =>
    [...each.absent, ...each.throws].filter(path => {
      const parts = path.split(".");
      const key = parts.at(-1)!;
      const kinds = parts.length === 1 ? [`global ${key}`] : parts.includes("prototype") ? [`property ${key}`] : owners[parts[0]!] ? [`${owners[parts[0]!]} ${key}`] : [`global ${parts[0]}`];
      return !each.features.some(feature => kinds.some(kind => known.has(`${feature} ${kind}`)));
    }),
  );
  expect(unknown).toEqual([]);
});

test("every vendored library stands in a library line, with the version that is built", () => {
  const plain = (name: string) => name.toLowerCase().replace(/[^a-z0-9]/g, "");
  const folder = join(dirname(doorsPath), "deps");
  const vendored = readdirSync(folder).filter(file => file.endsWith(".ts") && !["index.ts", "nodejs-headers.ts", "webkit.ts"].includes(file));
  const versions = vendored.map(file => {
    const pinned = /_COMMIT = "([0-9a-f]{40})";(?: \/\/ v?(\S+))?/.exec(readFileSync(join(folder, file), "utf8"));
    const inTree = /#define SQLITE_VERSION +"([^"]+)"/.exec(readFileSync(join(folder, "..", "..", "..", "src", "jsc", "bindings", "sqlite", "sqlite3_local.h"), "utf8"));
    return [basename(file, ".ts"), pinned ? (pinned[2] ?? pinned[1]!.slice(0, 8)) : inTree![1]!] as const;
  });
  const listed = versions.map(([name]) => {
    const library = all.libraries.find(each => plain(each.name).startsWith(plain(name)));
    return [name, library?.version] as const;
  });
  expect(listed).toEqual(versions);
  expect(all.libraries.length).toBe(vendored.length);
});

test("what compiled code calls, and what every executable needs, has no public name", () => {
  expect(all.names.flatMap(each => each.features).filter(feature => feature.startsWith("operations_") || feature === "file_sink")).toEqual([]);
});

const neverOffered: Record<string, string> = {
  "what compiled code calls follows the program's own code":
    "operations_common_data operations_common_objects operations_common_containers operations_common_text operations_common_numbers operations_rare_classes operations_rare_properties operations_rare_text operations_rare_data operations_rare_copies operations_rare_containers operations_rare_casts operations_rare_numbers",
  "a part of the language: a dependency may use it unseen":
    "atomics weak_references dataview sum_precise legacy_accessors get_or_insert set_methods json_raw promise_all promise_all_settled promise_any promise_race rare_array_methods typedarray_sort uint8array_base64 string_locale_case number_to_text string_padding string_html string_normalize string_well_formed string_repeat string_last_index_of escape_unescape uri_coding regexp regexp_properties float16array biguint64array bigint64array uint8clampedarray int16array int8array uint16array float32array int32array float64array uint32array",
  "Bun's own modules stand on it":
    "url events abort_signal headers form_data fs_stats web_streams bodies buffer file_sink text_codec base64_globals structured_clone outside_bytes node_fs node_os node_path node_validators node_util_natives node_small_modules node_url_natives string_decoder crypto_object brotli_decoder package_files node_http http_parser net_addresses",
  "too small to be worth a name":
    "unsafe ansi escape_html uuid node_assert module_graph node_v8 deep_equals parse_args console_table process_binding process_exec_argv process_usage process_about process_control bun_misc string_width",
  "it has no name yet":
    "bunfig cli_options compression_calls compression_streams histogram legacy_encodings libdeflate_compressor message_channel node_zlib performance_timeline post_message tls tls_users x509 x509_users zstd",
};

test("every feature has a public name, or a reason why it has none", () => {
  const named = new Set(all.names.flatMap(each => each.features));
  const excused = Object.values(neverOffered).flatMap(list => list.split(" "));
  expect(features.filter(feature => !named.has(feature) && !excused.includes(feature))).toEqual([]);
  expect(excused.filter((feature, index) => named.has(feature) || !features.includes(feature) || excused.indexOf(feature) !== index)).toEqual([]);
});
