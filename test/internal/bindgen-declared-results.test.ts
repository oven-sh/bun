import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { mkdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { crateOf } from "../../scripts/build/codegen.ts";
import * as b from "../../src/codegen/bindgen-lib.ts";
import { parseDeclaredType, typeScriptOf } from "../../src/codegen/declared-type-checks.ts";

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
  await using proc = Bun.spawn({
    cmd: [
      bunExe(),
      generator,
      `--sources=${sources.join(",")}`,
      "--types-only=",
      `--codegen-path=${codegenDir}`,
      `--types-path=${typesDir}`,
    ],
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

function countOf(text: string, part: string): number {
  return text.split(part).length - 1;
}

const panicOf = (member: string, type: string, owner = "Toy") =>
  `panicOnValueOutsideDeclaredType(vm, ${JSON.stringify(owner)}, ${JSON.stringify(member)}, ${JSON.stringify(type)});`;

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
  test("a declared result is checked where it leaves native code, in a build with assertions", async () => {
    const run = await runToy(
      toyMembers((...words) => `b.any.returning(${words.map(word => JSON.stringify(word)).join(", ")})`),
    );
    expect(run.stderr).not.toContain("error:");
    expect(run.exitCode).toBe(0);

    const impl = run.read("GeneratedToy.cpp");
    expect(impl).toContain('#include "DeclaredTypeChecks.h"');
    expect(countOf(impl, panicOf("load", "Promise"))).toBe(1);
    expect(countOf(impl, panicOf("chain", "this | undefined"))).toBe(1);
    expect(countOf(impl, panicOf("make", "Toy"))).toBe(1);
    expect(countOf(impl, panicOf("mode", "string"))).toBe(1);
    expect(countOf(impl, panicOf("level", "number"))).toBe(1);
    // What the getter answers, and what Rust puts into the field.
    expect(countOf(impl, panicOf("label", "string"))).toBe(2);
    expect(countOf(impl, "panicOnValueOutsideDeclaredType(")).toBe(7);
    expect(impl).toContain(
      "JSC::JSValue::decode(result) == callFrame->thisValue() || JSC::JSValue::decode(result).isUndefined()",
    );
    expect(impl).toContain("JSC::JSValue::decode(result).inherits<Bun::Bindgen::Generated::JSToy>()");
    expect(countOf(impl, "if constexpr (ASSERT_ENABLED || ASAN_ENABLED) {")).toBe(7);

    const types = run.readTypes();
    expect(types).toContain('"load": (() => Promise<unknown>);');
    expect(types).toContain('"chain": (() => this | undefined);');
    expect(types).toContain('"free": (() => any);');
    expect(types).toContain('readonly "label": string;');
    expect(types).toContain('readonly "count": number;');
    expect(types).toContain('readonly "plain": any;');
    expect(types).toContain('"make": (() => Toy);');
  });

  // A body may hand back any JSValue, JsLocal or JsWrapper under such a type.
  test("a result that the schema types as a class is checked too", async () => {
    const run = await runToy(`
      proto: {
        chain: { returns: b.self, passThis: true },
        next: { returns: b.self.nullable, capability: "heap" },
        peer: { getter: b.self.optional, capability: "heap" },
        first: { getter: b.self, cache: true, capability: "heap" },
      },
      static: { make: { returns: b.self, capability: "heap" } },
    `);
    expect(run.stderr).not.toContain("error:");
    expect(run.exitCode).toBe(0);
    const impl = run.read("GeneratedToy.cpp");
    expect(countOf(impl, panicOf("chain", "Toy"))).toBe(1);
    expect(countOf(impl, panicOf("next", "Toy | null"))).toBe(1);
    expect(countOf(impl, panicOf("peer", "Toy | undefined"))).toBe(1);
    expect(countOf(impl, panicOf("first", "Toy"))).toBe(2);
    expect(countOf(impl, panicOf("make", "Toy"))).toBe(1);
  });

  test("it asks nothing of Rust", async () => {
    const [declared, undeclared] = await Promise.all([
      runToy(toyMembers((...words) => `b.any.returning(${words.map(word => JSON.stringify(word)).join(", ")})`)),
      runToy(toyMembers(() => "b.any")),
    ]);
    expect(undeclared.read("GeneratedToy.cpp")).not.toContain("panicOnValueOutsideDeclaredType(");
    expect(declared.read("GeneratedToy.h")).toBe(undeclared.read("GeneratedToy.h"));
    // But for a store into the field of a cached getter, which goes through the check.
    const store = "Bun__Bindgen__Toy__labelSetCached(this_value, global.as_mut_ptr(), value)";
    const linesOf = (run: GeneratorRun) => run.read("generated_bindgen_bun_runtime.rs").split("\n");
    const added = linesOf(declared).filter(line => !linesOf(undeclared).includes(line));
    expect(added).toHaveLength(2);
    expect(added[0]).toContain(
      "fn Bun__Bindgen__Toy__labelSetCached(this_value: JSValue, global: *mut JSGlobalObject, value: JSValue);",
    );
    expect(added[1]).toContain(store);
    expect(undeclared.read("generated_bindgen_bun_runtime.rs")).not.toContain("labelSetCached");
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
      "a class that nobody knows",
      `proto: { x: { returns: b.any.returning("Nope"), capability: "heap" } }`,
      "no test is known for instances of Nope",
    ],
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

describe("the repository's own schemas", () => {
  test("every declared result is checked", async () => {
    using dir = tempDir("bindgen-declared-results-repository", {});
    const schemas = [...new Bun.Glob("src/**/*.bind.ts").scanSync({ cwd: repositoryRoot, absolute: true })].sort();
    const run = await runGenerator(
      String(dir),
      schemas.map(schema => `${crateOf(schema)}=${schema}`),
    );
    expect(run.stderr).not.toContain("error:");
    expect(run.exitCode).toBe(0);

    const impl = run.read("GeneratedResponse.cpp");
    for (const member of ["arrayBuffer", "blob", "bytes", "formData", "json", "text"]) {
      for (const owner of ["Request", "Response"]) expect(countOf(impl, panicOf(member, "Promise", owner))).toBe(1);
    }
    expect(countOf(impl, panicOf("method", "string", "Request"))).toBe(1);
    expect(countOf(impl, panicOf("clone", "Request", "Request"))).toBe(1);
    expect(countOf(impl, panicOf("clone", "Response", "Response"))).toBe(1);
    // A cached getter: what it answers, and what Rust puts into the field.
    expect(countOf(impl, panicOf("body", "ReadableStream | null", "Response"))).toBe(2);
    expect(countOf(impl, panicOf("headers", "Headers", "Request"))).toBe(2);
    // A class of another file.
    expect(run.read("GeneratedSubprocess.cpp")).toContain('#include "GeneratedResourceUsage.h"');
  });
});
