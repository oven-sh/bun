import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { bunExe, tempDir } from "harness";
import { readFileSync, readdirSync, realpathSync, statSync, utimesSync } from "node:fs";
import { join, relative } from "node:path";
import { zstdDecompressSync } from "node:zlib";
import {
  type EngineFunctions,
  functionIds,
  helperModules,
  locate,
  moduleList,
  specifierOf,
  typesOnlySchemas,
} from "../../src/codegen/builtins-manifest-model";
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

function createFixture(engine: EngineFunctions = engineFunctions) {
  const dir = tempDir("builtins-manifest", { "aot_engine_functions.json": JSON.stringify(engine) });
  const file = (name: string) => join(String(dir), name);
  return {
    file,
    manifest: file("builtins.manifest"),
    archive: file("builtin_sources.bin"),
    engineFlag: `--engine-functions=${file("aot_engine_functions.json")}`,
    [Symbol.dispose]: () => dir[Symbol.dispose](),
  };
}

function readArchive(file: string) {
  const bytes = readFileSync(file);
  const frames = new Map<string, Buffer>();
  for (let record = 4; record < 4 + bytes.readUInt32LE(0) * 72; record += 72) {
    const name = bytes.toString("latin1", record + 1, record + 1 + bytes[record]);
    const offset = bytes.readUInt32LE(record + 64);
    frames.set(name, bytes.subarray(offset, offset + bytes.readUInt32LE(record + 68)));
  }
  return { names: [...frames.keys()], read: (name: string) => zstdDecompressSync(frames.get(name)!).toString() };
}

describe("builtins-manifest.ts", () => {
  let fixture: ReturnType<typeof createFixture>;
  let records: string[][];

  beforeAll(async () => {
    fixture = createFixture();
    const { manifest, archive, engineFlag } = fixture;
    const runs = await Promise.all([
      bun("run", script, "--debug=OFF", manifest, archive, engineFlag),
      bun("run", script, "--debug=ON", fixture.file("debug.manifest"), engineFlag),
    ]);
    runs.forEach(expectSuccess);
    const lines = readFileSync(manifest, "utf8").trimEnd().split("\n");
    records = lines.map(line => line.split("\t"));
  }, generatorTimeout);

  afterAll(() => fixture[Symbol.dispose]());

  test("the manifest has format 4 and its five record kinds", () => {
    expect(records[0]).toEqual(["bun-builtins-manifest", "4"]);
    expect([...new Set(records.slice(1).map(([kind]) => kind))]).toEqual([
      "define",
      "module",
      "functions",
      "function",
      "declarations",
    ]);
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
      "bun:wrap": "runtime.bun.js",
      "-": "runtime.js",
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
    for (const name of ["runtime.js", "runtime.bun.js", "node/fs.ts", "builtins/Fifo.ts"]) {
      expect(read(name)).toBe(readFileSync(locate(name), "utf8"));
    }
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
      const { manifest, archive, engineFlag } = fixture;
      for (const file of [manifest, archive]) utimesSync(file, 1, 1);
      expectSuccess(await bun("run", script, "--debug=OFF", manifest, archive, engineFlag));
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
        const { manifest, archive } = broken;
        const result = await bun("run", script, "--debug=OFF", manifest, archive, ...flags.map(flag => broken[flag]));
        expect(result.stderr).toContain(message);
        expect(result.exitCode).toBe(1);
      },
      generatorTimeout,
    );
  }
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
