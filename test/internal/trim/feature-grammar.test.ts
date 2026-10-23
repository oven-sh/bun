import { describe, expect, test } from "bun:test";
import { tempDir } from "harness";
import { join } from "node:path";
import { BuildError } from "../../../scripts/build/error";
import { declarationsOf, documentedModules } from "../../../scripts/build/trim/declarations";
import {
  featureFiles,
  featureNamed,
  narrowestTrimFeature,
  parseFeatures,
  readFeatureModel,
  serializeFeatureModel,
} from "../../../scripts/build/trim/features";
import type { BuiltinEntry, BuiltinKind, BuiltinUses } from "../../../scripts/build/trim/types";

type Files = Partial<Record<(typeof featureFiles)[number], string>>;

const parse = (files: Files) =>
  parseFeatures(Object.entries(files).map(([name, text]) => ({ name: name as (typeof featureFiles)[number], text })));

function buildErrorOf(action: () => unknown): BuildError {
  try {
    action();
  } catch (error) {
    expect(error).toBeInstanceOf(BuildError);
    return error as BuildError;
  }
  throw new Error("expected a BuildError");
}

const repeated = (count: number, line: (index: number) => string) =>
  Array.from({ length: count }, (_, index) => line(index)).join("\n");

function readJson(text: string) {
  using directory = tempDir("feature-grammar", { "model.json": text });
  return readFeatureModel(join(String(directory), "model.json"));
}

const sample: Files = {
  "engine.def": `# engine features
feature JIT "the JIT"
  entered-from startup

feature Wasm "WebAssembly"
`,
  "bun.def": `feature Sqlite "bun:sqlite"
\tentered-from command-line
  exports
  minimum 100
feature Zlib "zlib"
  minimum 5 macho
  minimum 6 elf
`,
  "node.def": `feature NodeFs "node:fs"
  c-function fs_open fs_close
  c-function fs_read
  cxx-function fs fs::File<true[,>]
`,
  "trim-features.def": `trim-feature sqlite-all : Zlib Sqlite
  about "All of \`bun:sqlite\`."
  also "first"
  also "second"
  saves 1.5 2
trim-feature only-sqlite : Sqlite
  about "Only sqlite."
trim-feature same-size : Sqlite
  about "Same size."
`,
  "icu-data.def": `icu-data collation : Zlib Sqlite
icu-data zone except-windows : NodeFs
icu-data locales by-locale : NodeFs
icu-data units except-windows by-locale : Zlib
icu-data unused :
icu-language-group no nb nn
icu-language-group sr hr
`,
};

describe("parseFeatures", () => {
  const model = parse(sample);

  test("numbers engine features from 0 and the others from 128 across files", () => {
    expect(model.features.map(({ name, index, isEngine }) => [name, index, isEngine])).toEqual([
      ["JIT", 0, true],
      ["Wasm", 1, true],
      ["Sqlite", 128, false],
      ["Zlib", 129, false],
      ["NodeFs", 130, false],
    ]);
  });

  test("numbers features in file-list order regardless of input order", () => {
    const reversed = parseFeatures([
      { name: "node.def", text: 'feature B "b"' },
      { name: "bun.def", text: 'feature A "a"' },
    ]);
    expect(reversed.features.map(({ name, index }) => [name, index])).toEqual([
      ["A", 128],
      ["B", 129],
    ]);
  });

  test("reads every attribute", () => {
    expect(featureNamed(model, "Sqlite")).toEqual({
      name: "Sqlite",
      rustName: "Sqlite",
      index: 128,
      text: "bun:sqlite",
      enteredFrom: "command-line",
      isEngine: false,
      minimumBytes: { elf: 100, macho: 100, coff: 100 },
      exports: true,
    });
    expect(featureNamed(model, "JIT").enteredFrom).toBe("startup");
    expect(featureNamed(model, "Zlib")).toEqual({
      name: "Zlib",
      rustName: "Zlib",
      index: 129,
      text: "zlib",
      enteredFrom: "program",
      isEngine: false,
      minimumBytes: { macho: 5, elf: 6 },
      exports: false,
    });
  });

  test("reads the C functions of a feature in the order written, and a feature without any has no list", () => {
    expect(featureNamed(model, "NodeFs").cFunctions).toEqual(["fs_open", "fs_close", "fs_read"]);
    expect(featureNamed(model, "Zlib")).not.toHaveProperty("cFunctions");
    expect(featureNamed(model, "NodeFs").cxxFunctions).toEqual([{ hint: "fs", pattern: "fs::File<true[,>]" }]);
    expect(featureNamed(model, "Zlib")).not.toHaveProperty("cxxFunctions");
  });

  test("reads trim features and ICU lines, with member lists sorted by index", () => {
    expect(model.trimFeatures[0]).toEqual({
      name: "sqlite-all",
      features: ["Sqlite", "Zlib"],
      about: "All of `bun:sqlite`.",
      also: ["first", "second"],
      saves: { linux: 1.5, macos: 2 },
      rustName: "SqliteAll",
    });
    expect(model.icuData).toEqual([
      { itemClass: "collation", exceptWindows: false, byLocale: false, features: ["Sqlite", "Zlib"] },
      { itemClass: "zone", exceptWindows: true, byLocale: false, features: ["NodeFs"] },
      { itemClass: "locales", exceptWindows: false, byLocale: true, features: ["NodeFs"] },
      { itemClass: "units", exceptWindows: true, byLocale: true, features: ["Zlib"] },
      { itemClass: "unused", exceptWindows: false, byLocale: false, features: [] },
    ]);
    expect(model.icuLanguageGroups).toEqual([
      ["no", "nb", "nn"],
      ["sr", "hr"],
    ]);
  });

  test("skips comments and blank lines without closing a declaration", () => {
    const { features } = parse({ "bun.def": 'feature A "a"\n\n   \n  # comment\n# comment\n  exports\n' });
    expect(features[0]!.exports).toBe(true);
  });

  test("computes Rust names", () => {
    const names = ["JIT", "URICoding", "JSONRawJSON", "StringHTML", "Uint8ArrayBase64"];
    const { features } = parse({ "bun.def": names.map(name => `feature ${name} "text"`).join("\n") });
    expect(features.map(({ rustName }) => rustName)).toEqual([
      "Jit",
      "UriCoding",
      "JsonRawJson",
      "StringHtml",
      "Uint8ArrayBase64",
    ]);
    const trimFeatures = parse({
      "bun.def": 'feature A "a"',
      "trim-features.def": 'trim-feature html-rewriter : A\n  about "x"',
    }).trimFeatures;
    expect(trimFeatures[0]!.rustName).toBe("HtmlRewriter");
  });

  test("featureNamed rejects a name that is not declared", () => {
    expect(buildErrorOf(() => featureNamed(model, "Missing")).message).toBe("unknown feature: Missing");
  });

  test("narrowestTrimFeature takes the fewest members, then the first declared", () => {
    expect(narrowestTrimFeature(model, "Sqlite")?.name).toBe("only-sqlite");
    expect(narrowestTrimFeature(model, "Zlib")?.name).toBe("sqlite-all");
    expect(narrowestTrimFeature(model, "NodeFs")).toBeUndefined();
  });

  describe("hash", () => {
    const files = (changes: Files = {}): Files => ({
      "bun.def": 'feature A "a"\nfeature B "b"',
      "trim-features.def": 'trim-feature a : A\n  about "x"',
      "icu-data.def": "icu-data zone : A\nicu-language-group no nb",
      ...changes,
    });
    const base = parse(files()).hash;

    test.each<[string, Files]>([
      ["a feature's text", { "bun.def": 'feature A "another"\nfeature B "b"' }],
      ["a minimum", { "bun.def": 'feature A "a"\n  minimum 5\nfeature B "b"' }],
      [
        "a trim feature's texts and sizes",
        { "trim-features.def": 'trim-feature a : A\n  about "y"\n  also "z"\n  saves 1 2' },
      ],
    ])("leaves out %s", (_, changes) => {
      expect(parse(files(changes)).hash).toBe(base);
    });

    test.each<[string, Files]>([
      ["a feature's name", { "bun.def": 'feature A "a"\nfeature C "b"' }],
      ["a feature's index", { "bun.def": 'feature B "b"\nfeature A "a"' }],
      ["where a feature is entered from", { "bun.def": 'feature A "a"\nfeature B "b"\n  entered-from startup' }],
      ["exports", { "bun.def": 'feature A "a"\nfeature B "b"\n  exports' }],
      ["a trim feature's name", { "trim-features.def": 'trim-feature b : A\n  about "x"' }],
      ["a trim feature's members", { "trim-features.def": 'trim-feature a : A B\n  about "x"' }],
      ["an ICU line's class", { "icu-data.def": "icu-data units : A\nicu-language-group no nb" }],
      ["an ICU line's features", { "icu-data.def": "icu-data zone : B\nicu-language-group no nb" }],
      ["except-windows", { "icu-data.def": "icu-data zone except-windows : A\nicu-language-group no nb" }],
      ["by-locale", { "icu-data.def": "icu-data zone by-locale : A\nicu-language-group no nb" }],
      ["a language group", { "icu-data.def": "icu-data zone : A\nicu-language-group no nb nn" }],
      ["the absence of a language group", { "icu-data.def": "icu-data zone : A" }],
    ])("covers %s", (_, changes) => {
      expect(parse(files(changes)).hash).not.toBe(base);
    });
  });
});

test("the JSON form round trips", () => {
  const model = parse(sample);
  expect(readJson(serializeFeatureModel(model))).toEqual(model);
});

const oneFeature = 'feature A "a"';
const trimFile = (text: string): Files => ({ "bun.def": 'feature A "a"\nfeature B "b"', "trim-features.def": text });
const icuFile = (text: string): Files => ({ "bun.def": 'feature A "a"\nfeature B "b"', "icu-data.def": text });

const rejected: [name: string, files: Files, site: string][] = [
  ["feature in trim-features.def", { "trim-features.def": oneFeature }, "trim-features.def:1"],
  ["feature in icu-data.def", { "icu-data.def": oneFeature }, "icu-data.def:1"],
  ["trim-feature in bun.def", { "bun.def": 'trim-feature a : A\n  about "x"' }, "bun.def:1"],
  ["icu-data in bun.def", { "bun.def": "icu-data a :" }, "bun.def:1"],
  ["icu-language-group in bun.def", { "bun.def": "icu-language-group no nb" }, "bun.def:1"],
  ["too many engine features", { "engine.def": repeated(129, index => `feature E${index} "e"`) }, "engine.def:129"],
  ["index limit", { "bun.def": repeated(385, index => `feature E${index} "e"`) }, "bun.def:385"],
  [
    "too many trim features",
    trimFile(repeated(257, index => `trim-feature t${index} : A\n  about "x"`)),
    "trim-features.def:513",
  ],
  ["two features with the same Rust name", { "bun.def": 'feature JIT "a"\nfeature Jit "b"' }, "bun.def:2"],
  [
    "two trim features with the same Rust name",
    trimFile('trim-feature a1 : A\n  about "x"\ntrim-feature a-1 : A\n  about "x"'),
    "trim-features.def:3",
  ],
  ["unknown first word", { "bun.def": "door A" }, "bun.def:1"],
  ["indented line without declaration", { "bun.def": "  exports" }, "bun.def:1"],
  [
    "indented line does not continue the previous file",
    { "engine.def": oneFeature, "bun.def": "  exports" },
    "bun.def:1",
  ],
  ["unknown feature attribute", { "bun.def": `${oneFeature}\n  about "x"` }, "bun.def:2"],
  ["c-function without a name", { "bun.def": `${oneFeature}\n  c-function` }, "bun.def:2"],
  ["c-function that is not a C name", { "bun.def": `${oneFeature}\n  c-function Bun::open` }, "bun.def:2"],
  [
    "the same c-function twice in a feature",
    { "bun.def": `${oneFeature}\n  c-function open\n  c-function open` },
    "bun.def:3",
  ],
  ["cxx-function without a pattern", { "bun.def": `${oneFeature}\n  cxx-function uWS` }, "bun.def:2"],
  [
    "cxx-function whose hint is no identifier",
    { "bun.def": `${oneFeature}\n  cxx-function uWS:: uWS::App` },
    "bun.def:2",
  ],
  [
    "cxx-function that is no regular expression",
    { "bun.def": `${oneFeature}\n  cxx-function uWS uWS::(` },
    "bun.def:2",
  ],
  [
    "the same cxx-function twice in a feature",
    { "bun.def": `${oneFeature}\n  cxx-function uWS uWS::App\n  cxx-function uWS uWS::App` },
    "bun.def:3",
  ],
  ["unknown trim feature attribute", trimFile('trim-feature a : A\n  about "x"\n  exports'), "trim-features.def:3"],
  ["indented line under icu-data", icuFile("icu-data a : A\n  exports"), "icu-data.def:2"],
  ["indented line under icu-language-group", icuFile("icu-language-group no nb\n  exports"), "icu-data.def:2"],
  ["feature without text", { "bun.def": "feature A" }, "bun.def:1"],
  ["feature with an extra word", { "bun.def": 'feature A B "a"' }, "bun.def:1"],
  ["flag with a word", { "bun.def": `${oneFeature}\n  exports yes` }, "bun.def:2"],
  ["minimum without words", { "bun.def": `${oneFeature}\n  minimum` }, "bun.def:2"],
  ["minimum with three words", { "bun.def": `${oneFeature}\n  minimum 1 elf macho` }, "bun.def:2"],
  ["trim feature without members", trimFile('trim-feature a :\n  about "x"'), "trim-features.def:1"],
  ["trim feature without colon", trimFile('trim-feature a A B\n  about "x"'), "trim-features.def:1"],
  ["about without text", trimFile("trim-feature a : A\n  about"), "trim-features.def:2"],
  ["saves with one word", trimFile('trim-feature a : A\n  about "x"\n  saves 1'), "trim-features.def:3"],
  ["icu-data without colon", { "icu-data.def": "icu-data a" }, "icu-data.def:1"],
  [
    "icu-data with by-locale before except-windows",
    icuFile("icu-data a by-locale except-windows : A"),
    "icu-data.def:1",
  ],
  ["icu-data with except-windows twice", icuFile("icu-data a except-windows except-windows : A"), "icu-data.def:1"],
  ["icu-data with an unknown word before the colon", icuFile("icu-data a sometimes : A"), "icu-data.def:1"],
  ["language group of one language", icuFile("icu-language-group no"), "icu-data.def:1"],
  ["language in upper case", icuFile("icu-language-group no NB"), "icu-data.def:1"],
  ["language of four letters", icuFile("icu-language-group no root"), "icu-data.def:1"],
  ["language twice in a group", icuFile("icu-language-group no nb no"), "icu-data.def:1"],
  ["language in two groups", icuFile("icu-language-group no nb\nicu-language-group nn nb"), "icu-data.def:2"],
  ["invalid feature name", { "bun.def": 'feature abc "a"' }, "bun.def:1"],
  ["invalid trim feature name", trimFile('trim-feature Abc : A\n  about "x"'), "trim-features.def:1"],
  ["malformed JSON text", { "bun.def": 'feature A "a' }, "bun.def:1"],
  ["words after a text", { "bun.def": 'feature A "a" b' }, "bun.def:1"],
  ["empty text", { "bun.def": 'feature A ""' }, "bun.def:1"],
  ["text outside printable ASCII", { "bun.def": 'feature A "caf\\u00e9"' }, "bun.def:1"],
  ["text with a line break", { "bun.def": 'feature A "a\\nb"' }, "bun.def:1"],
  [
    "duplicate entered-from",
    { "bun.def": `${oneFeature}\n  entered-from startup\n  entered-from command-line` },
    "bun.def:3",
  ],
  ["unknown entered-from", { "bun.def": `${oneFeature}\n  entered-from someone` }, "bun.def:2"],
  ["entered-from program", { "bun.def": `${oneFeature}\n  entered-from program` }, "bun.def:2"],
  ["entered-from without a word", { "bun.def": `${oneFeature}\n  entered-from` }, "bun.def:2"],
  ["duplicate about", trimFile('trim-feature a : A\n  about "x"\n  about "y"'), "trim-features.def:3"],
  ["duplicate saves", trimFile('trim-feature a : A\n  about "x"\n  saves 1 2\n  saves 3 4'), "trim-features.def:4"],
  ["non-numeric saves", trimFile('trim-feature a : A\n  about "x"\n  saves 1 x'), "trim-features.def:3"],
  ["duplicate minimum for one format", { "bun.def": `${oneFeature}\n  minimum 1 elf\n  minimum 2` }, "bun.def:3"],
  ["negative minimum", { "bun.def": `${oneFeature}\n  minimum -1` }, "bun.def:2"],
  ["minimum for an unknown format", { "bun.def": `${oneFeature}\n  minimum 1 wasm` }, "bun.def:2"],
  ["feature declared twice", { "engine.def": oneFeature, "bun.def": oneFeature }, "bun.def:1"],
  [
    "trim feature declared twice",
    trimFile('trim-feature a : A\n  about "x"\ntrim-feature a : B\n  about "y"'),
    "trim-features.def:3",
  ],
  ["ICU class declared twice", { "icu-data.def": "icu-data a :\nicu-data a :" }, "icu-data.def:2"],
  ["same member twice in a trim feature", trimFile('trim-feature a : A A\n  about "x"'), "trim-features.def:1"],
  ["same member twice in an ICU line", icuFile("icu-data a : A A"), "icu-data.def:1"],
  ["trim feature naming an unknown feature", trimFile('trim-feature a : Z\n  about "x"'), "trim-features.def:1"],
  ["icu-data naming an unknown feature", { "icu-data.def": "icu-data a : Z" }, "icu-data.def:1"],
  ["trim feature without about", trimFile("trim-feature a : A"), "trim-features.def:1"],
];

describe("errors", () => {
  test.each(rejected)("%s", (_, files, site) => {
    expect(buildErrorOf(() => parse(files)).file).toBe(`src/trim/features/${site}`);
  });

  test.each([
    "decided-by engine",
    "used-with B",
    "runs-unknown-code",
    "builtin Bun.x",
    "module bun:x",
    "internal-module internal/x",
    "class X",
    "native x.rs open",
  ])("a feature no longer takes %s", line => {
    const error = buildErrorOf(() => parse({ "bun.def": `${oneFeature}\nfeature B "b"\n  ${line}` }));
    expect(error.message).toBe(`unknown feature attribute: ${line.split(" ")[0]}`);
    expect(error.file).toBe("src/trim/features/bun.def:3");
  });

  test("a trim feature no longer takes tolerates", () => {
    const error = buildErrorOf(() => parse(trimFile('trim-feature a : A\n  about "x"\n  tolerates B')));
    expect(error.message).toBe("unknown trim-feature attribute: tolerates");
    expect(error.file).toBe("src/trim/features/trim-features.def:3");
  });

  test("says that program is the default", () => {
    expect(buildErrorOf(() => parse({ "bun.def": `${oneFeature}\n  entered-from program` })).message).toBe(
      "entered-from program is the default",
    );
  });

  test("says in which order an ICU line takes its words", () => {
    expect(buildErrorOf(() => parse(icuFile("icu-data a by-locale except-windows : A"))).message).toBe(
      "icu-data takes its class, except-windows, by-locale and a colon, in that order",
    );
  });

  test("reports both lines for a name declared twice", () => {
    const error = buildErrorOf(() => parse({ "bun.def": `${oneFeature}\nfeature B "b"\n${oneFeature}` }));
    expect(error.message).toBe("feature A is declared twice, first at src/trim/features/bun.def:1");
    expect(error.file).toBe("src/trim/features/bun.def:3");
  });
});

describe("declarationsOf", () => {
  type Use = string | { conditional: string };
  let nextId = 0;
  const entry = (path: string, kind: BuiltinKind, uses: Use[], hasHiddenRoot = false): BuiltinEntry => ({
    id: nextId++,
    path,
    kind,
    uses: uses.map(use =>
      typeof use === "string"
        ? { feature: use, isConditional: false }
        : { feature: use.conditional, isConditional: true },
    ),
    nativeSymbols: [],
    hasHiddenRoot,
  });
  const longAbout = Array.from({ length: 40 }, () => "wrapped").join(" ");
  const model = parse({
    "bun.def": 'feature Alpha "alpha"\nfeature Beta "beta"\n',
    "trim-features.def": `trim-feature single : Alpha
  about "${longAbout}"
  saves 0.01 0.04
trim-feature pair : Alpha Beta
  about "Both."
  also "the first"
  also "the second"
  saves 1.5 2.5
trim-feature second : Beta
  about "Beta."
`,
  });
  const uses: BuiltinUses = {
    entries: [
      entry("Bun.alpha", "Namespace", ["Alpha"]),
      entry("Bun.run", "Function", ["Alpha"]),
      entry("Bun.Alpha", "Constructor", ["Alpha"]),
      entry("Bun.Alpha.prototype", "Prototype", ["Alpha"]),
      entry("bun:alpha", "Module", ["Alpha"]),
      entry("Bun.beta", "Accessor", ["Beta"]),
      entry("Bun.gamma", "Constant", ["Beta"]),
      entry("Bun.delta", "DataProperty", ["Beta"]),
      entry("Bun.method", "Method", ["Beta"]),
      entry("beta.rs open", "NativeBinding", ["Beta"]),
      entry("internal/beta", "InternalModule", ["Beta"]),
    ],
  };
  const text = declarationsOf(model, uses);
  const commentOf = (declarations: string, name: string) => {
    const end = declarations.indexOf(`      | "${name}"`);
    return declarations.slice(declarations.lastIndexOf("      /**", end), end);
  };

  test("starts with the generated line and ends the union", () => {
    expect(text.split("\n")[0]).toBe(
      "// Generated by scripts/build/trim/declarations.ts from src/trim/features/*.def and the built-ins table. Do not edit by hand.",
    );
    expect(text).toContain('      | "single"\n');
    expect(text).toContain('      | "pair"\n');
    expect(text).toContain('      | "second";\n');
  });

  test("a call, a construction and an accessor throw, each in its own form", () => {
    expect(commentOf(text, "single")).toContain(
      "       * Without it, `Bun.run()` and `new Bun.Alpha()` throw an `Error`.\n",
    );
    expect(commentOf(text, "pair")).toContain(
      "       * Without it, `Bun.run()`, `new Bun.Alpha()`, `Bun.beta` and `Bun.method()` throw an `Error`.\n",
    );
    expect(commentOf(text, "second")).toContain(
      "       * Without it, `Bun.beta` and `Bun.method()` throw an `Error`.\n",
    );
    const one = declarationsOf(model, { entries: [entry("Bun.run", "Function", ["Alpha"])] });
    expect(commentOf(one, "single")).toContain("       * Without it, `Bun.run()` throws an `Error`.\n");
  });

  test("nothing a program can test for is documented as gone", () => {
    expect(text).not.toContain("`undefined`");
    for (const path of ["`Bun.alpha`", "Bun.Alpha.prototype", "Bun.gamma", "Bun.delta", "beta.rs", "internal/beta"])
      expect(text).not.toContain(path);
  });

  test("prints modules, also and saves", () => {
    expect(commentOf(text, "single")).toContain("       * Without it, importing `bun:alpha` throws an `Error`.\n");
    expect(commentOf(text, "pair")).toContain("       * Also needs it: the first; the second.\n");
    expect(commentOf(text, "single")).toContain("       * Adds under 0.1 MB by itself.\n");
    expect(commentOf(text, "pair")).toContain("       * Adds about 1.5 MB on Linux x64 and 2.5 MB on macOS arm64.\n");
    expect(commentOf(text, "second")).not.toContain("Adds");
    expect(commentOf(text, "second")).not.toContain("Also needs it");
  });

  test("wraps at 100 columns", () => {
    const lines = text.split("\n").filter(line => line.includes("wrapped"));
    expect(lines.length).toBeGreaterThan(1);
    for (const line of lines) expect(line.length).toBeLessThanOrEqual(100);
    expect(lines.map(line => line.replace("       * ", "")).join(" ")).toBe(longAbout);
  });

  test("an entry is documented under the feature that guards it: its first unconditional use", () => {
    const declarations = declarationsOf(model, {
      entries: [
        entry("Bun.first", "Function", ["Alpha", "Beta"]),
        entry("Bun.later", "Function", [{ conditional: "Alpha" }, "Beta"]),
        entry("Bun.sometimes", "Function", [{ conditional: "Alpha" }, { conditional: "Beta" }]),
      ],
    });
    expect(commentOf(declarations, "single")).toContain("       * Without it, `Bun.first()` throws an `Error`.\n");
    expect(commentOf(declarations, "second")).toContain("       * Without it, `Bun.later()` throws an `Error`.\n");
    expect(declarations).not.toContain("Bun.sometimes");
  });

  test("leaves out an entry that no path from the global object names", () => {
    const declarations = declarationsOf(model, {
      entries: [
        entry("%AlphaIterator%.prototype.next", "Method", ["Alpha"], true),
        entry("Bun.run", "Function", ["Alpha"]),
      ],
    });
    expect(commentOf(declarations, "single")).toContain("       * Without it, `Bun.run()` throws an `Error`.\n");
    expect(declarations).not.toContain("AlphaIterator");
  });

  test("prints the public modules only", () => {
    const modules: BuiltinUses = {
      entries: [
        entry("bun:alpha", "Module", ["Alpha"]),
        entry("internal/alpha", "InternalModule", ["Alpha"]),
        entry("internal/beta", "InternalModule", ["Alpha"]),
        entry("node:alpha", "Module", ["Alpha"]),
      ],
    };
    const declarations = declarationsOf(model, modules);
    expect(commentOf(declarations, "single")).toContain(
      "       * Without it, importing `bun:alpha` and `node:alpha` throws an `Error`.\n",
    );
    expect(declarations).not.toContain("internal/");
    expect(documentedModules(model, modules, model.trimFeatures[0]!)).toEqual(["bun:alpha", "node:alpha"]);
    expect(documentedModules(model, modules, model.trimFeatures[2]!)).toEqual([]);
  });

  test("prints no sentence on imports when every module is internal", () => {
    expect(declarationsOf(model, { entries: [entry("internal/alpha", "InternalModule", ["Alpha"])] })).not.toContain(
      "Without it, importing",
    );
  });

  describe("by where a feature is entered from", () => {
    const withTests = (attribute: string) =>
      parse({
        "bun.def": `feature Alpha "alpha"\nfeature Tests "tests"\n${attribute}`,
        "trim-features.def": 'trim-feature alpha : Alpha Tests\n  about "Alpha."\n',
      });
    const entries = [
      entry("bun:alpha", "Module", ["Alpha"]),
      entry("Bun.tests", "Function", ["Tests"]),
      entry("bun:tests", "Module", ["Tests"]),
    ];

    test("leaves out a feature that only the command line enters", () => {
      const declarations = declarationsOf(withTests("  entered-from command-line\n"), { entries });
      expect(declarations).toContain("       * Without it, importing `bun:alpha` throws an `Error`.\n");
      expect(declarations).not.toContain("bun:tests");
      expect(declarations).not.toContain("Bun.tests");
    });

    test.each(["", "  entered-from startup\n"])("documents a feature with the attribute %j", attribute => {
      const declarations = declarationsOf(withTests(attribute), { entries });
      expect(declarations).toContain("       * Without it, `Bun.tests()` throws an `Error`.\n");
      expect(declarations).toContain("       * Without it, importing `bun:alpha` and `bun:tests` throws an `Error`.\n");
    });
  });

  test("rejects an unknown kind", () => {
    const changed = { entries: [entry("Bun.run", "Door" as BuiltinKind, ["Alpha"])] };
    expect(buildErrorOf(() => declarationsOf(model, changed)).message).toBe("built-in Bun.run has unknown kind Door");
  });
});
