import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { existsSync, mkdirSync, readFileSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { parseDeclaredType, typeScriptOf } from "../../src/codegen/class-definitions.ts";

const repositoryRoot = resolve(import.meta.dir, "../..");
const generator = join(repositoryRoot, "src/codegen/generate-classes.ts");
const classDefinitions = join(repositoryRoot, "src/codegen/class-definitions.ts");

interface GeneratorRun {
  exitCode: number;
  stderr: string;
  read(name: string): string;
  readTypes(): string;
}

async function runGenerator(root: string, classFiles: string[]): Promise<GeneratorRun> {
  const codegenDir = join(root, "codegen");
  const typesDir = join(root, "types");
  mkdirSync(codegenDir, { recursive: true });
  mkdirSync(typesDir, { recursive: true });
  await using proc = Bun.spawn({
    cmd: [bunExe(), generator, ...classFiles, codegenDir, typesDir],
    cwd: repositoryRoot,
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  return {
    exitCode,
    stderr,
    read: name => readFileSync(join(codegenDir, name), "utf8"),
    readTypes: () => readFileSync(join(typesDir, "ZigGeneratedClasses.d.ts"), "utf8"),
  };
}

function toyClassFile(definition: string): string {
  return `import { define } from ${JSON.stringify(classDefinitions)};
export default [define({ name: "Toy", rustPath: "crate::toy::Toy", construct: true, ${definition} })];
`;
}

async function runToy(definition: string): Promise<GeneratorRun> {
  using dir = tempDir("generate-classes-toy", { "toy.classes.ts": toyClassFile(definition) });
  const root = String(dir);
  const run = await runGenerator(root, [join(root, "toy.classes.ts")]);
  if (run.exitCode !== 0) return run;
  const outputs = new Map<string, string>();
  for (const name of [
    "generated_classes.rs",
    "ZigGeneratedClasses.cpp",
    "ZigGeneratedClasses.h",
    "ZigGeneratedClasses+lazyStructureImpl.h",
  ]) {
    outputs.set(name, run.read(name));
  }
  const types = run.readTypes();
  return { ...run, read: name => outputs.get(name)!, readTypes: () => types };
}

function countOf(text: string, part: string): number {
  return text.split(part).length - 1;
}

describe("parseDeclaredType", () => {
  test("reads each alternative", () => {
    for (const word of ["string", "number", "int32", "boolean", "undefined", "null", "Promise"]) {
      expect(parseDeclaredType(word)).toEqual([word]);
    }
    expect(parseDeclaredType("Headers")).toEqual([{ instance: "Headers" }]);
    expect(parseDeclaredType("ReadableStream | null")).toEqual([{ instance: "ReadableStream" }, "null"]);
    expect(parseDeclaredType("Promise<Response>")).toEqual(["Promise"]);
    expect(parseDeclaredType("Promise<string | null> | null")).toEqual(["Promise", "null"]);
    expect(parseDeclaredType("Promise<Response | Array<string>>")).toEqual(["Promise"]);
    expect(parseDeclaredType("string | number")).toEqual(["string", "number"]);
  });

  test("rejects text outside the grammar", () => {
    for (const text of ["unknown", "string[]", "", "null | null", "Promise<string> | Promise<number>"]) {
      expect(() => parseDeclaredType(text)).toThrow(`'${text}' is not a declared type`);
    }
  });

  test("typeScriptOf reads int32 as number", () => {
    expect(typeScriptOf("int32 | null")).toBe("number | null");
  });

  test("typeScriptOf gives a bare Promise a type argument", () => {
    expect(typeScriptOf("Promise")).toBe("Promise<unknown>");
    expect(typeScriptOf("Promise<Response>")).toBe("Promise<Response>");
  });
});

describe("generated bindings of a toy class", () => {
  test("wraps declared results and leaves the compiler out", async () => {
    const hostClassesFile = join(repositoryRoot, "src/aot/build/host-classes.txt");
    const modifiedBefore = existsSync(hostClassesFile) ? statSync(hostClassesFile).mtimeMs : undefined;
    const run = await runToy(`
      lockedPrototype: true,
      klass: { make: { fn: "make", returns: "Toy" } },
      proto: {
        label: { getter: "getLabel", cache: true, type: "string" },
        count: { getter: "getCount", type: "int32" },
        plain: { getter: "getPlain" },
        note: { getter: "getNote", cache: true },
        load: { fn: "load", returns: "Promise" },
        first: { fn: "shared" },
        second: { fn: "shared" },
      },
    `);
    expect(run.stderr).not.toContain("error:");
    expect(run.exitCode).toBe(0);

    const rust = run.read("generated_classes.rs");
    expect(rust).toContain("proven_return::proven_return::<return_kind::String, _>(Toy::get_label(t, g))");
    expect(rust).toContain("value: Proven<return_kind::String>");
    expect(rust).toContain("label_clear_cached");
    expect(rust).toContain("proven_return::proven_return::<return_kind::Promise, _>(Toy::load(t, g, c))");
    expect(rust).toContain("proven_return::proven_return::<return_kind::Instance<Toy>, _>(Toy::make(g, c))");
    const plainStart = rust.indexOf("ToyPrototype__getPlain");
    expect(plainStart).toBeGreaterThan(-1);
    expect(rust.slice(plainStart, rust.indexOf("jsc_host_abi!", plainStart))).not.toContain("proven_return");

    const impl = run.read("ZigGeneratedClasses.cpp");
    expect(impl).not.toContain("AOTFunction.h");
    expect(impl).not.toContain("HostClassCachedGetter");
    expect(impl).not.toContain("class JSToyPrototype final");
    expect(impl).toMatch(/panicOnValueOutsideDeclaredType\([^;]*"Toy", "load", "Promise"\)/);
    for (const text of [rust, impl]) {
      expect(text).toContain("ToyPrototype__labelSetProvenCachedValue(");
      expect(text).not.toContain("ToyPrototype__labelSetCachedValue(");
      expect(text).toContain("ToyPrototype__noteSetCachedValue(");
      expect(text).toContain("Toy__isInstance(");
    }
    expect(rust).toContain("pub fn is_wrapper(value: JSValue) -> bool");
    expect(run.read("ZigGeneratedClasses.h")).toContain("class JSToyPrototype final");

    const lazy = run.read("ZigGeneratedClasses+lazyStructureImpl.h");
    expect(lazy).not.toContain("GeneratedLazyClassJSResponse");

    expect(run.readTypes()).toContain("count: number");
    expect(run.readTypes()).toContain("load(): Promise<unknown>;");
    expect(existsSync(hostClassesFile) ? statSync(hostClassesFile).mtimeMs : undefined).toBe(modifiedBefore);
  });

  test.each([
    ["two alternatives", `proto: { x: { getter: "getX", type: "string | number" } }`, "x"],
    ["an unknown class", `proto: { x: { getter: "getX", type: "Nope" } }`, "x"],
    ["one function with two types", `proto: { x: { fn: "f", returns: "string" }, y: { fn: "f", returns: "number" } }`, "x"],
    ["jsonTextForm on the prototype", `proto: { x: { fn: "f", jsonTextForm: { argument: 0, fn: "g" } } }`, "x"],
    [
      "a typed getter in a slot of another name",
      `proto: { x: { getter: "getX", cache: "other", type: "string" }, other: { getter: "getOther" } }`,
      "x",
    ],
    [
      "an untyped getter in a typed slot",
      `proto: { owner: { getter: "getOwner", cache: true, type: "string" }, x: { getter: "getX", cache: "owner" } }`,
      "x",
    ],
    [
      "a writable getter in a typed slot",
      `proto: { owner: { getter: "getOwner", cache: true, type: "string" }, x: { getter: "getX", cache: "owner", writable: true, type: "string" } }`,
      "x",
    ],
    ["a typed writable getter", `proto: { x: { getter: "getX", cache: true, writable: true, type: "string" } }`, "x"],
  ])("fails on %s", async (_, definition, member) => {
    const run = await runToy(definition);
    expect(run.stderr).toMatch(new RegExp(`Toy(\\.|: )${member}\\b`));
    expect(run.exitCode).not.toBe(0);
  });
});

describe("the repository's own class definitions", () => {
  test("every declared getter is wrapped, and removable classes are guarded", async () => {
    using dir = tempDir("generate-classes-repository", {});
    const classFiles = [...new Bun.Glob("src/**/*.classes.ts").scanSync({ cwd: repositoryRoot, absolute: true })].sort();
    const run = await runGenerator(String(dir), classFiles);
    expect(run.stderr).not.toContain("error:");
    expect(run.exitCode).toBe(0);

    const blocks = run.read("generated_classes.rs").split(/\/\/ ═+\n\/\/ (\w+)\n\/\/ ═+\n/);
    const blockOf = (name: string) => blocks[blocks.indexOf(name) + 1];
    expect(countOf(blockOf("Request"), "proven_return::<")).toBe(12 + 2);
    expect(countOf(blockOf("Response"), "proven_return::<")).toBe(7 + 2);
  });
});
