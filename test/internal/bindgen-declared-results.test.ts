import { describe, expect, test } from "bun:test";
import { bunExe, tempDir } from "harness";
import { mkdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import * as b from "../../src/codegen/bindgen-lib.ts";
import { parseDeclaredType, typeScriptOf } from "../../src/codegen/declared-type-checks.ts";
import { run as runCommand } from "../aot/harness/run";

const repositoryRoot = resolve(import.meta.dir, "../..");
const generator = join(repositoryRoot, "src/codegen/bindgen.ts");
const library = join(repositoryRoot, "src/codegen/bindgen-lib.ts");

interface GeneratorRun {
  exitCode: number;
  stderr: string;
  read(name: string): string;
  readTypes(): string;
}

/** `sources` are `<crate>=<a.bind.ts>`. */
async function runGenerator(root: string, sources: string[]): Promise<GeneratorRun> {
  const codegenDir = join(root, "codegen");
  const typesDir = join(root, "types");
  mkdirSync(codegenDir, { recursive: true });
  mkdirSync(typesDir, { recursive: true });
  const { stderr, exitCode } = await runCommand(
    [
      bunExe(),
      generator,
      `--sources=${sources.join(",")}`,
      "--types-only=",
      `--codegen-path=${codegenDir}`,
      `--types-path=${typesDir}`,
    ],
    repositoryRoot,
  );
  return {
    exitCode,
    stderr,
    read: name => readFileSync(join(codegenDir, name), "utf8"),
    readTypes: () => readFileSync(join(typesDir, "Bindgen.d.ts"), "utf8"),
  };
}

function toySchema(definition: string): string {
  return `import * as b from ${JSON.stringify(library)};
export const Toy = b.class({ rustPath: "crate::toy::Toy", construct: {}, ${definition} });
`;
}

async function runToy(definition: string): Promise<GeneratorRun> {
  using dir = tempDir("bindgen-declared-results", { "toy.bind.ts": toySchema(definition) });
  const root = String(dir);
  const run = await runGenerator(root, [`bun_runtime=${join(root, "toy.bind.ts")}`]);
  if (run.exitCode !== 0) return run;
  const outputs = new Map<string, string>();
  for (const name of ["generated_bindgen_bun_runtime.rs", "GeneratedToy.cpp", "GeneratedToy.h"]) {
    outputs.set(name, run.read(name));
  }
  const types = run.readTypes();
  return { ...run, read: name => outputs.get(name)!, readTypes: () => types };
}

describe("the words of .returning", () => {
  test("each word is taken", () => {
    for (const word of [
      "string",
      "number",
      "int32",
      "bigint",
      "boolean",
      "undefined",
      "null",
      "object",
      "Promise",
      "this",
    ]) {
      expect(b.any.returning(word).checkedResult).toEqual([word]);
      expect(parseDeclaredType(word)).toEqual([word]);
    }
    expect(b.any.returning("ReadableStream", "null").checkedResult).toEqual(["ReadableStream", "null"]);
    expect(parseDeclaredType("Headers")).toEqual([{ instance: "Headers" }]);
    expect(parseDeclaredType("ReadableStream | null")).toEqual([{ instance: "ReadableStream" }, "null"]);
    expect(parseDeclaredType("string | number")).toEqual(["string", "number"]);
  });

  test("anything else is refused", () => {
    for (const word of ["unknown", "string[]", "", "string | null", "Promise<string>"]) {
      expect(() => b.any.returning(word)).toThrow(`'${word}' is not a declared type`);
    }
    expect(() => b.any.returning("null", "null")).toThrow();
    expect(() => b.any.returning()).toThrow(".returning takes what the result can be");
    for (const text of ["unknown", "string[]", "", "null | null"]) {
      expect(() => parseDeclaredType(text)).toThrow(`'${text}' is not a declared type`);
    }
  });

  test("a type in the words of the table is not checked", () => {
    expect(b.any.returning({ type: "Primitive", primitive: "String" }).checkedResult).toBeNull();
    expect(b.any.returning("string", { type: "Operand", operand: "output" }).checkedResult).toBeNull();
    expect(b.any.checkedResult).toBeNull();
  });

  test("the table reads the words", () => {
    expect(b.any.returning("this").resultType).toEqual({ type: "Operand", operand: "this" });
    expect(b.any.returning("Blob").resultType).toMatchObject({ type: "Instance", class: "Blob" });
    expect(b.any.returning("string", "null").resultType).toEqual({
      type: "Union",
      members: [
        { type: "Primitive", primitive: "String" },
        { type: "Primitive", primitive: "Null" },
      ],
    });
  });

  test("typeScriptOf spells them as TypeScript does", () => {
    expect(typeScriptOf(["int32", "null"])).toBe("number | null");
    expect(typeScriptOf(["Promise"])).toBe("Promise<unknown>");
    expect(typeScriptOf(["Array", "undefined"])).toBe("unknown[] | undefined");
    expect(typeScriptOf(["Headers"])).toBe("Headers");
  });
});

const toyMembers = (declare: (...words: string[]) => string) => `
  proto: {
    label: { getter: ${declare("string")}, cache: true, capability: "heap" },
    count: { getter: b.i32, pure: true },
    plain: { getter: b.any, capability: "heap" },
    level: { getter: ${declare("number")}, setter: true, capability: "heap" },
    load: { returns: ${declare("Promise")}, capability: "js", throws: true },
    chain: { returns: ${declare("this", "undefined")}, capability: "heap" },
    free: { returns: b.any, capability: "heap" },
  },
  static: {
    make: { returns: ${declare("Toy")}, capability: "heap" },
    mode: { getter: ${declare("string")}, capability: "heap" },
  },
`;

describe("generated bindings of a toy class", () => {
  test("a declared result is what TypeScript sees", async () => {
    const run = await runToy(
      toyMembers((...words) => `b.any.returning(${words.map(word => JSON.stringify(word)).join(", ")})`),
    );
    expect(run.stderr).not.toContain("error:");
    expect(run.exitCode).toBe(0);

    const types = run.readTypes();
    expect(types).toContain('"load": (() => Promise<unknown>);');
    expect(types).toContain('"chain": (() => this | undefined);');
    expect(types).toContain('"free": (() => any);');
    expect(types).toContain('readonly "label": string;');
    expect(types).toContain('readonly "count": number;');
    expect(types).toContain('readonly "plain": any;');
    expect(types).toContain('"make": (() => Toy);');
  });

  test("it changes no binding", async () => {
    const [declared, undeclared] = await Promise.all([
      runToy(toyMembers((...words) => `b.any.returning(${words.map(word => JSON.stringify(word)).join(", ")})`)),
      runToy(toyMembers(() => "b.any")),
    ]);
    for (const name of ["generated_bindgen_bun_runtime.rs", "GeneratedToy.cpp", "GeneratedToy.h"]) {
      expect(declared.read(name)).toBe(undeclared.read(name));
    }
  });

  test("the keys that only the table reads change no binding", async () => {
    const [plain, annotated] = await Promise.all([
      runToy(`proto: { count: { getter: b.i32 }, read: { args: { from: b.any }, capability: "heap" } }`),
      runToy(`
        lockedObjects: ["prototype"],
        types: [{ path: ["$Node", "Toy"], isView: false, typeArguments: [] }],
        proto: {
          count: { getter: b.i32, pure: true },
          read: { args: { from: b.any }, capability: "heap", uses: { this: [], from: [{ use: "ReadsContents" }] } },
        },
      `),
    ]);
    expect(annotated.stderr).not.toContain("error:");
    expect(annotated.exitCode).toBe(0);
    for (const name of ["generated_bindgen_bun_runtime.rs", "GeneratedToy.cpp", "GeneratedToy.h"]) {
      expect(annotated.read(name)).toBe(plain.read(name));
    }
    expect(annotated.readTypes()).toBe(plain.readTypes());
  });

  test.each([
    [
      "a word outside the grammar",
      `proto: { x: { returns: b.any.returning("string[]"), capability: "heap" } }`,
      "'string[]' is not a declared type",
    ],
    [
      "a declared result without a capability",
      `proto: { x: { returns: b.any.returning("string") } }`,
      'returning a JS value takes capability: "heap" or "js"',
    ],
    [
      "a pure getter with a capability",
      `proto: { x: { getter: b.i32, capability: "heap", pure: true } }`,
      "x: a pure getter has no capability, throws, cache or passThis",
    ],
    [
      "a pure getter that throws",
      `proto: { x: { getter: b.i32, throws: true, pure: true } }`,
      "x: a pure getter has no capability, throws, cache or passThis",
    ],
    [
      "a pure getter that is cached",
      `proto: { x: { getter: b.i32, cache: true, pure: true } }`,
      "x: a pure getter has no capability, throws, cache or passThis",
    ],
    [
      "a pure getter that takes its wrapper",
      `proto: { x: { getter: b.i32, passThis: true, pure: true } }`,
      "x: a pure getter has no capability, throws, cache or passThis",
    ],
    [
      "a pure getter that answers a cell",
      `proto: { x: { getter: b.string, pure: true } }`,
      "x: a pure getter allocates nothing",
    ],
  ])("fails on %s", async (_, definition, message) => {
    const run = await runToy(definition);
    expect(run.stderr).toContain(message);
    expect(run.exitCode).not.toBe(0);
  });
});
