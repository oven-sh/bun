import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { bunExe, tempDir } from "harness";
import { readdirSync, readFileSync, realpathSync, statSync, utimesSync } from "node:fs";
import { join, relative } from "node:path";
import { zstdDecompressSync } from "node:zlib";
import {
  type EngineFunctions,
  functionIds,
  helperModules,
  locate,
  moduleList,
  sourceFiles,
  specifierOf,
  typesOnlySchemas,
} from "../../src/codegen/builtins-manifest-model";
import { listBundledNamesOfModule } from "../../src/codegen/bundled-names";
import {
  Aligner,
  encodeWordsInEvaluatedText,
  findWordsInEvaluatedText,
  findWordsOfFirstText,
  moveBundledNamesToSecondText,
  Words,
} from "../../src/codegen/bundled-positions";
import { run } from "../aot/harness/run";

const root = join(import.meta.dir, "..", "..");
const textsForTheCompiler = readdirSync(join(root, "src", "js", "ahead-of-time"), {
  recursive: true,
  withFileTypes: true,
})
  .filter(entry => entry.isFile())
  .map(entry =>
    relative(join(root, "src", "js", "ahead-of-time"), join(entry.parentPath, entry.name)).replaceAll("\\", "/"),
  );
// A module of those, and a word that both of its texts have. The first comment of the text that is bundled is not in the other.
const moduleOfTwoTexts = "internal/primordials.js";
const wordOfBothTexts = "ObjectSetPrototypeOf = Object.setPrototypeOf;";
const offsetOfWordOfBothTexts = (...folders: string[]) =>
  readFileSync(join(root, "src", "js", ...folders, moduleOfTwoTexts)).indexOf(wordOfBothTexts);
const script = join(root, "src", "codegen", "builtins-manifest.ts");
// A debug build takes seconds to load the script and to compress the archive.
const generatorTimeout = 120_000;

async function bun(...args: string[]) {
  const { stdout, stderr, exitCode } = await run([bunExe(), ...args], root);
  return { stdout, stderr, exitCode };
}

function expectSuccess({ stderr, exitCode }: { stderr: string; exitCode: number }) {
  expect({ exitCode, stderr: exitCode === 0 ? "" : stderr }).toEqual({ exitCode: 0, stderr: "" });
}

const engineFunctions: EngineFunctions = {
  files: [
    { name: "A.js", text: "function first() {}\n" },
    { name: "notes.txt", text: "" },
  ],
  functions: [{ id: 7, file: "A.js", name: "first", exportName: "first" }],
};

// What `bun run` evaluates for node/os.ts. The other modules have an empty text.
const evaluatedText = readFileSync(join(root, "src", "js", "node", "os.ts"), "latin1").replaceAll("const ", "let ");

function createEvaluatedModules() {
  const [header, record] = [48, 24];
  const section = Buffer.alloc(header + sourceFiles.length * record + evaluatedText.length);
  [sourceFiles.length, header, 0, 0, header + sourceFiles.length * record, evaluatedText.length].forEach(
    (value, index) => section.writeUInt32LE(value, 16 + index * 4),
  );
  section.writeUInt32LE(evaluatedText.length, header + sourceFiles.indexOf("node/os.ts") * record + 20);
  section.write(evaluatedText, header + sourceFiles.length * record, "latin1");
  return section;
}

function createFixture(engine: EngineFunctions = engineFunctions) {
  const dir = tempDir("builtins-manifest", {
    "evaluated_modules.bin": createEvaluatedModules(),
    "aot_engine_functions.json": JSON.stringify(engine),
    "bundled_names_of_modules.txt": [
      `name\tnode/fs.ts\t12\tread2\town`,
      `positions\tnode/fs.ts\t${Buffer.from([1, 2, 3]).toString("base64")}`,
      `name\t${moduleOfTwoTexts}\t3\tcall2\tvariable`,
      `name\t${moduleOfTwoTexts}\t${offsetOfWordOfBothTexts()}\tset2\tvariable`,
      `positions\t${moduleOfTwoTexts}\t${Buffer.from([4]).toString("base64")}`,
      `positions\tnode/os.ts\t${Buffer.from([5, 6]).toString("base64")}`,
      ``,
    ].join("\n"),
    "runtime.out.js": "var a=()=>1;export{a as __name};",
  });
  const file = (name: string) => join(String(dir), name);
  return {
    file,
    manifest: file("builtins.manifest"),
    archive: file("builtin_sources.bin"),
    engineFlag: `--engine-functions=${file("aot_engine_functions.json")}`,
    nameFlags: [
      `--bundled-names-of-modules=${file("bundled_names_of_modules.txt")}`,
      `--bundled-helpers=${file("runtime.out.js")}`,
      `--evaluated-modules=${file("evaluated_modules.bin")}`,
    ],
    [Symbol.dispose]: () => dir[Symbol.dispose](),
  };
}

function readArchive(file: string) {
  const bytes = readFileSync(file);
  const files = bytes.subarray(4 + bytes.readUInt32LE(0));
  const records = zstdDecompressSync(bytes.subarray(4, 4 + bytes.readUInt32LE(0)));
  const frames = new Map<string, { frame: Buffer; module: number; text: () => Buffer }>();
  for (let record = 0; record < records.length; record += 76) {
    const name = records.toString("latin1", record + 1, record + 1 + records[record]);
    const offset = records.readUInt32LE(record + 64);
    const frame = files.subarray(offset, offset + records.readUInt32LE(record + 68));
    const module = records.readUInt32LE(record + 72) - 1;
    const dictionary = sourceFiles[module] === "node/os.ts" ? Buffer.from(evaluatedText, "latin1") : undefined;
    frames.set(name, { frame, module, text: () => zstdDecompressSync(frame, { dictionary }) });
  }
  return { names: [...frames.keys()], read: (name: string) => frames.get(name)!.text().toString(), frames };
}

describe("builtins-manifest.ts", () => {
  let fixture: ReturnType<typeof createFixture>;
  let records: string[][];

  beforeAll(async () => {
    fixture = createFixture();
    const { manifest, archive, engineFlag, nameFlags } = fixture;
    const runs = await Promise.all([
      bun("run", script, "--debug=OFF", manifest, archive, engineFlag, ...nameFlags),
      bun("run", script, "--debug=ON", fixture.file("debug.manifest"), engineFlag, ...nameFlags),
    ]);
    runs.forEach(expectSuccess);
    const lines = readFileSync(manifest, "utf8").trimEnd().split("\n");
    records = lines.map(line => line.split("\t"));
  }, generatorTimeout);

  afterAll(() => fixture[Symbol.dispose]());

  test("the manifest has format 6 and its seven record kinds", () => {
    expect(records[0]).toEqual(["bun-builtins-manifest", "6"]);
    expect([...new Set(records.slice(1).map(([kind]) => kind))]).toEqual([
      "define",
      "module",
      "functions",
      "function",
      "declarations",
      "declares-for-every-file",
      "name",
    ]);
  });

  test("the names are those of the bundled texts, at the words of a second text that stand for their identifiers", () => {
    expect(records.filter(([kind]) => kind === "name")).toEqual([
      ["name", "node/fs.ts", "12", "read2", "own"],
      ["name", moduleOfTwoTexts, String(offsetOfWordOfBothTexts("ahead-of-time")), "set2", "variable"],
    ]);
    expect(offsetOfWordOfBothTexts("ahead-of-time")).not.toBe(offsetOfWordOfBothTexts());
  });

  test("the positions of all modules are one file of the archive, each part behind the id of its module and its length", () => {
    // 7 bits a byte, the lowest first.
    const idOf = (file: string) => {
      const id = moduleList.indexOf(file);
      expect(id).toBeWithin(0, 128 * 128);
      return id < 128 ? [id] : [(id & 127) | 128, id >> 7];
    };
    expect([...readArchive(fixture.archive).frames.get("positions")!.text()]).toEqual([
      ...[...idOf("node/fs.ts"), 3, 1, 2, 3],
      ...[...idOf(moduleOfTwoTexts), 1, 4],
      ...[...idOf("node/os.ts"), 2, 5, 6],
    ]);
  });

  test("a module is compressed as what follows on the text that is evaluated for it", () => {
    const { read, frames } = readArchive(fixture.archive);
    for (const [id, file] of sourceFiles.entries()) expect([file, frames.get(file)!.module]).toEqual([file, id]);
    expect(frames.get("manifest")!.module).toBe(-1);
    const text = readFileSync(join(root, "src", "js", "node", "os.ts"), "utf8");
    expect(read("node/os.ts")).toBe(text);
    expect(frames.get("node/os.ts")!.frame.length).toBeLessThan(text.length / 20);
    expect(() => zstdDecompressSync(frames.get("node/os.ts")!.frame)).toThrow();
  });

  test("the defines do not depend on --debug", () => {
    expect(records).toContainEqual(["define", "IS_BUN_DEVELOPMENT", "false"]);
    expect(records).toContainEqual(["define", "process.env.NODE_ENV", '"production"']);
    const defines = records.filter(([kind]) => kind === "define");
    for (const [, , json] of defines) expect(() => JSON.parse(json)).not.toThrow();
    expect(readFileSync(fixture.file("debug.manifest"), "utf8")).toBe(readFileSync(fixture.manifest, "utf8"));
  });

  test("module ids ascend from 0 without a gap", () => {
    const modules = records.filter(([kind]) => kind === "module");
    expect(modules.map(([, id]) => Number(id))).toEqual(Array.from(modules, (_, id) => id));
    expect(modules.length).toBe(moduleList.length + helperModules.length);
    expect(Object.fromEntries(modules.map(([, , path, specifier]) => [specifier, path]))).toMatchObject({
      "node:fs": "node/fs.ts",
      ws: "thirdparty/ws.ts",
      "@vercel/fetch": "thirdparty/vercel_fetch.js",
      "bun:wrap": "runtime.out.js",
      "bun:main": "runtime.main.js",
      "node:buffer": "-",
    });
  });

  test("the engine's function files come from the list of its files", () => {
    const files = records.filter(([kind]) => kind === "functions").map(([, file]) => file);
    expect(files.filter(file => file.startsWith("engine/"))).toEqual(["engine/A.js"]);
    expect(files).toContain("builtins/Fifo.ts");
    expect(records).toContainEqual(["function", "7", "engine/A.js", "first"]);
    const createFIFO = String(functionIds.get("Fifo.ts\tcreateFIFO"));
    expect(records).toContainEqual(["function", createFIFO, "builtins/Fifo.ts", "createFIFO"]);
  });

  test("the archive has every source and the merged tsconfig.json", () => {
    const { names, read } = readArchive(fixture.archive);
    expect(names).toEqual(names.toSorted());
    expect(names).not.toContain("engine/notes.txt");
    expect(read("engine/A.js")).toBe("function first() {}\n");
    expect(read("manifest")).toBe(readFileSync(fixture.manifest, "utf8"));
    expect(read("engine/A.js")).toBe("function first() {}\n");
    for (const name of ["node/fs.ts", "builtins/Fifo.ts"]) {
      expect(read(name)).toBe(readFileSync(locate(name), "utf8"));
    }
    // The helpers of the bundler are compiled from the text that `bun run` evaluates.
    expect(read("runtime.out.js")).toBe(readFileSync(fixture.file("runtime.out.js"), "utf8"));
    expect(read("runtime.main.js")).toBe(readFileSync(join(root, "src", "runtime.main.js"), "utf8"));
    // What private.d.ts says a module answers lies beside the module, so whoever reads the one need not read all the others.
    const listings = records.filter(([kind]) => kind === "declarations").map(([, name]) => name);
    expect(names).toEqual(expect.arrayContaining(listings));
    expect(read("node/fs.listed.d.ts")).toContain('  "node:fs": $ModuleValue<typeof import("./fs")>;\n');
    const modulesListedIn = (text: string) =>
      [...text.matchAll(/^  "([^"]+)": \$ModuleValue<typeof import\(/gm)].map(([, name]) => name);
    const written = readFileSync(locate("private.d.ts"), "utf8");
    const besideModules = listings.flatMap(name => modulesListedIn(read(name)));
    expect(besideModules).toContain("node:fs");
    expect(modulesListedIn(read("private.d.ts"))).not.toContain("node:fs");
    expect([...modulesListedIn(read("private.d.ts")), ...besideModules].toSorted()).toEqual(
      modulesListedIn(written).toSorted(),
    );
    expect(read("private.d.ts").split("\n").length + besideModules.length).toBe(written.split("\n").length);
    // A module's second text, for the compiler alone, goes under the module's own name.
    expect(names.filter(name => name.startsWith("ahead-of-time/"))).toEqual([]);
    for (const name of textsForTheCompiler) {
      expect(read(name)).toBe(readFileSync(join(root, "src", "js", "ahead-of-time", name), "utf8"));
      expect(read(name)).not.toBe(readFileSync(join(root, "src", "js", name), "utf8"));
    }
    expect(read("node/path.ts")).toBe(readFileSync(join(root, "src", "js", "node", "path.ts"), "utf8"));
    const tsconfig = JSON.parse(read("tsconfig.json"));
    expect(Object.keys(tsconfig)).toEqual(["compilerOptions"]);
    expect(tsconfig.compilerOptions).toMatchObject({ experimentalDecorators: true, baseUrl: ".", composite: false });
  });

  test(
    "a second run writes neither file again",
    async () => {
      const { manifest, archive, engineFlag, nameFlags } = fixture;
      for (const file of [manifest, archive]) utimesSync(file, 1, 1);
      expectSuccess(await bun("run", script, "--debug=OFF", manifest, archive, engineFlag, ...nameFlags));
      expect([manifest, archive].map(file => statSync(file).mtimeMs)).toEqual([1000, 1000]);
    },
    generatorTimeout,
  );

  const failures: {
    name: string;
    engine?: EngineFunctions;
    flags: "engineFlag"[];
    message: string;
  }[] = [
    { name: "no --engine-functions", flags: [], message: "--engine-functions=<aot_engine_functions.json>" },
    {
      name: "a function of a file that holds no functions",
      engine: { ...engineFunctions, functions: [{ id: 7, file: "notes.txt", name: "first", exportName: "first" }] },
      flags: ["engineFlag"],
      message: "the function first of notes.txt",
    },
    {
      name: "a function of a file that is not listed",
      engine: { ...engineFunctions, functions: [{ id: 7, file: "Stray.js", name: "first", exportName: "first" }] },
      flags: ["engineFlag"],
      message: "the function first of Stray.js",
    },
  ];
  for (const { name, engine, flags, message } of failures) {
    test.concurrent(
      `fails with ${name}`,
      async () => {
        using broken = createFixture(engine);
        const { manifest, archive, nameFlags } = broken;
        const given = [...flags.map(flag => broken[flag]), ...nameFlags];
        const result = await bun("run", script, "--debug=OFF", manifest, archive, ...given);
        expect(result.stderr).toContain(message);
        expect(result.exitCode).toBe(1);
      },
      generatorTimeout,
    );
  }
});

describe("bundled-names.ts", () => {
  test("lists the identifiers that name a function otherwise in the bundle than in the file", async () => {
    const written = [
      `const stream = require("node:stream");`,
      `{`,
      `  function inBlock() {}`,
      `  stream.first = inBlock;`,
      `}`,
      `stream.second = function setTimeout() {};`,
      `function kept() {}`,
      `export default () => [kept, setTimeout];`,
      ``,
    ].join("\n");
    const given = "var $;" + written.replace(`require("node:stream")`, "lookUp(12)").replace("export default", "$ =");
    using dir = tempDir("bundled-names", { "module.ts": given + "done($);\n" });
    const built = await Bun.build({
      entrypoints: [join(String(dir), "module.ts")],
      target: "bun",
      minify: { syntax: true, keepNames: true },
      sourcemap: "external",
    });
    const [output, map] = await Promise.all(
      ["entry-point", "sourcemap"].map(kind => built.outputs.find(it => it.kind === kind)!.text()),
    );
    const lines = listBundledNamesOfModule("node/sample.ts", written, output, JSON.parse(map));
    const at = (text: string) => String(written.indexOf(text));
    expect(lines.map(line => line.split("\t"))).toEqual([
      ["name", "node/sample.ts", at("inBlock() {}"), "inBlock2", "variable"],
      ["name", "node/sample.ts", at("setTimeout() {}"), "setTimeout2", "own"],
      ["name", "node/sample.ts", at("export default"), "$", "variable"],
    ]);
  });
});

describe("bundled-positions.ts", () => {
  test("finds where the tokens of a file stand in the text that is evaluated", async () => {
    const written = [
      `const stream = require("node:stream");`,
      `// Nothing of this line is evaluated.`,
      `function check(value: unknown, name: string): void {`,
      `  if (typeof value !== "string") {`,
      `    throw $ERR_INVALID_ARG_TYPE(name, "string", value);`,
      `  }`,
      `  stream.$call(value!, false);`,
      `  (stream as any).end(name);`,
      `}`,
      `export default check;`,
      ``,
    ].join("\n");
    const given =
      "var $;" +
      written
        .replace(
          `require("node:stream")`,
          "(__intrinsic__getInternalField(12) || __intrinsic__createInternalModuleById(12))",
        )
        .replace("$ERR_INVALID_ARG_TYPE(", "__intrinsic__makeErrorWithCode(118, ")
        .replace("$call", "__intrinsic__call")
        .replace("export default", "$ =");
    using dir = tempDir("bundled-positions", { "module.ts": given + "done($);\n" });
    const built = await Bun.build({
      entrypoints: [join(String(dir), "module.ts")],
      target: "bun",
      minify: { syntax: true, keepNames: true },
      sourcemap: "external",
    });
    const [output, map] = await Promise.all(
      ["entry-point", "sourcemap"].map(kind => built.outputs.find(it => it.kind === kind)!.text()),
    );
    const evaluated = `(function (){"use strict";${output.replace("// @bun\n", "").trim()}})`.replace(
      /__intrinsic__/g,
      "@",
    );
    const [words, wordsOfEvaluated] = [new Words(written), new Words(evaluated)];
    const found = findWordsInEvaluatedText(words, output, JSON.parse(map), wordsOfEvaluated);
    const encoded = encodeWordsInEvaluatedText(words, wordsOfEvaluated, found);

    const numbers: number[] = [];
    for (let at = 0, scale = 1; at < encoded.length; at++) {
      if (scale === 1) numbers.push(0);
      numbers[numbers.length - 1] += (encoded[at] & 127) * scale;
      scale = encoded[at] < 128 ? 1 : scale * 128;
    }
    const aligner = new Aligner(words, wordsOfEvaluated);
    for (let corrected = numbers.shift(); aligner.written < words.length;) {
      if (aligner.written !== corrected) {
        aligner.step(corrected ?? words.length);
        continue;
      }
      const distance = numbers.shift()! - 1;
      if (distance < 0) aligner.passOver();
      else aligner.correct(distance & 1 ? -(distance >> 1) - 1 : distance >> 1);
      corrected = numbers.length > 0 ? corrected + numbers.shift()! : undefined;
    }
    for (const [word, partner] of found) expect([word, aligner.partners[word]]).toEqual([word, partner]);

    const partnerOf = (inWritten: string) => aligner.partners[words.starts.indexOf(written.indexOf(inWritten))];
    const textAt = (inWritten: string) => evaluated.slice(wordsOfEvaluated.starts[partnerOf(inWritten)]);
    const textBehind = (inWritten: string) => evaluated.slice(wordsOfEvaluated.ends[partnerOf(inWritten)]);
    expect(textBehind(`require("node:stream")`)).toStartWith("(12)");
    expect(textBehind(`$ERR_INVALID_ARG_TYPE(name, "string", value)`)).toStartWith(`(118, name, "string", value)`);
    expect(textAt(`$ERR_INVALID_ARG_TYPE`)).toStartWith("makeErrorWithCode(");
    expect(textBehind(`$call(value!, false)`)).toStartWith("(value, !1)");
    expect(textBehind(`stream.$call`)).toStartWith(".@call(");
    expect(textBehind(`stream as any).end(name)`)).toStartWith(".end(name)");
    expect(textBehind(`end(name);`)).toStartWith("(name)");
    expect(partnerOf("unknown")).toBe(-1);
    expect(partnerOf("Nothing")).toBe(-1);
    expect(encoded.length).toBeLessThan(written.length / 40);
  });
});

describe("bundled-positions.ts, a second text", () => {
  const first = [
    "const copy = (from, to) => {",
    "  for (const key of keys(from)) to[key] = from[key].$call(to);",
    "  return to;",
    "};",
    "export default {",
    "  one: copy(a, b),",
    "  two: copy(c, d),",
    "};",
  ].join("\n");

  test("a line of both texts stands for the line of the same number, and a quote for its last word", () => {
    const second = [
      "const copy = (from, to) => /* as: from[key].$call */ copyNatively(from, to);",
      "const one = /* as: one: copy */ copy(a, b);",
      "  return to;",
      "export default {",
      "  one,",
      "  two: copy(c, d),",
      "};",
    ].join("\n");
    const [words, wordsOfFirst] = [new Words(second), new Words(first)];
    const found = findWordsOfFirstText(words, wordsOfFirst);
    const textAt = (inSecond: string) => {
      const partner = found.get(words.starts.indexOf(second.indexOf(inSecond)));
      return partner === undefined ? undefined : first.slice(wordsOfFirst.starts[partner]);
    };
    expect(textAt("copyNatively(")).toStartWith("$call(to)");
    expect(textAt("copy(a, b)")).toStartWith("copy(a, b)");
    expect(textAt("copy(c, d)")).toStartWith("copy(c, d)");
    expect(textAt("return to")).toStartWith("return to");
    expect(textAt("default {")).toStartWith("default {");
    expect(textAt("one = ")).toBeUndefined();
  });

  test("between lines of both texts, words in the same order stand for each other", () => {
    const second = [
      "const copy = (from: Bag, to: Bag): Bag => {",
      "  for (const key of keys(from)) to[key] = from[key].$call(to);",
      "  return to as Bag;",
      "};",
      "export default {",
      "  two: copy(c, d),",
      "};",
    ].join("\n");
    const [words, wordsOfFirst] = [new Words(second), new Words(first)];
    const found = findWordsOfFirstText(words, wordsOfFirst);
    const textAt = (inSecond: string) => {
      const partner = found.get(words.starts.indexOf(second.indexOf(inSecond)));
      return partner === undefined ? undefined : first.slice(wordsOfFirst.starts[partner]);
    };
    expect(textAt("copy = ")).toStartWith("copy = (from, to) => {");
    expect(textAt("to: Bag")).toStartWith("to) => {");
    expect(textAt("Bag,")).toBeUndefined();
    expect(textAt("return to as")).toStartWith("return to;");
    expect(textAt("to as")).toStartWith("to;");
    expect(textAt("as Bag")).toBeUndefined();
  });

  test("a name of the bundle goes to the word of the second text that stands for its identifier", () => {
    const second = first.replace("(from, to) =>", "(from: Bag, to: Bag): Bag =>").replace("  two: copy(c, d),\n", "");
    const line = (text: string, word: string, name: string) =>
      `name\tnode/sample.ts\t${text.indexOf(word)}\t${name}\tvariable`;
    expect(
      moveBundledNamesToSecondText([line(first, "copy =", "copy2"), line(first, "two:", "two2")], second, first),
    ).toEqual([line(second, "copy =", "copy2")]);
  });

  test("a quote that the first text does not have once is refused", () => {
    const find = (second: string) => () => findWordsOfFirstText(new Words(second), new Words(first));
    expect(find("/* as: copy */ copy();")).toThrow('The other text does not have "copy" once');
    expect(find("/* as: three: copy */ copy();")).toThrow('The other text does not have "three: copy" once');
    expect(find("/* as: one: copy( */ copy();")).toThrow("does not end with a word");
  });
});

describe("builtins-manifest-model.ts", () => {
  test(
    "a types-only schema gets no native call id",
    async () => {
      const model = JSON.stringify(join(root, "src", "codegen", "builtins-manifest-model.ts"));
      const nativeCallIds = async (...argv: string[]): Promise<(number | null)[]> => {
        const result = await bun(
          "-e",
          `import { nativeCalls, typesOnlySchemas } from ${model};
           console.log(JSON.stringify(nativeCalls(typesOnlySchemas(${JSON.stringify(argv)})).map(call => call.id)));`,
        );
        expectSuccess(result);
        return JSON.parse(result.stdout);
      };
      const [all, compiled] = await Promise.all([nativeCallIds(), nativeCallIds("--types-only=bindgen_test.bind.ts")]);
      const numbered = compiled.filter(id => id !== null);
      expect(all).toEqual(Array.from(all, (_, id) => id));
      expect(compiled.length).toBe(all.length);
      expect(numbered).toEqual(Array.from(numbered, (_, id) => id));
      expect(numbered.length).toBeGreaterThan(0);
      expect(numbered.length).toBeLessThan(all.length);
    },
    generatorTimeout,
  );

  test("typesOnlySchemas reads the list of the flag", () => {
    const schemas = typesOnlySchemas(["--debug=ON", "--types-only=a.bind.ts,b.bind.ts"]);
    expect(schemas).toEqual(new Set(["a.bind.ts", "b.bind.ts"]));
    expect(typesOnlySchemas(["--types-only="])).toEqual(new Set());
    expect(typesOnlySchemas([])).toEqual(new Set());
  });

  test("specifierOf", () => {
    expect(specifierOf("node/fs.promises.ts")).toBe("node:fs/promises");
    expect(specifierOf("bun/sqlite.ts")).toBe("bun:sqlite");
    expect(specifierOf("internal/validators.ts")).toBe("internal/validators");
    expect(specifierOf("thirdparty/ws.ts")).toBe("ws");
    expect(specifierOf("thirdparty/vercel_fetch.js")).toBe("@vercel/fetch");
    expect(specifierOf("runtime.js")).toBeUndefined();
  });

  test("helper module ids follow the registry's", () => {
    expect(helperModules.map(helper => helper.id)).toEqual(helperModules.map((_, index) => moduleList.length + index));
  });

  test("the registry has no text that is for --aot only", () => {
    expect(moduleList.filter(file => file.startsWith("ahead-of-time/"))).toEqual([]);
    expect(
      functionIds
        .keys()
        .filter(key => key.includes("ahead-of-time"))
        .toArray(),
    ).toEqual([]);
    expect(textsForTheCompiler).toContain("internal/primordials.js");
    // The model starts from its own folder, which is the real one where `src` is a link.
    const sources = realpathSync(join(root, "src", "js"));
    for (const file of textsForTheCompiler) {
      expect(moduleList).toContain(file);
      expect(locate(file)).toBe(join(sources, "ahead-of-time", file));
    }
    expect(locate("node/path.ts")).toBe(join(sources, "node", "path.ts"));
  });
});
