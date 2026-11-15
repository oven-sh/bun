import { expect, test } from "bun:test";
import { bunExe, isASAN, tempDir } from "harness";
import { basename, join, resolve } from "node:path";
import { crateOf } from "../../../scripts/build/codegen.ts";
import { globAllSources } from "../../../scripts/glob-sources.ts";
import type { Schema } from "../../../src/codegen/aot-schema/load.ts";
import { buildEntries, ModelBuilder } from "../../../src/codegen/builtins/build-entries.ts";
import { undescribedProperties } from "../../../src/codegen/builtins/check-dependencies.ts";
import { collectModules } from "../../../src/codegen/builtins/collect-modules.ts";
import {
  Problems,
  type Declaration,
  type MemberDeclaration,
  type SourcedDeclaration,
} from "../../../src/codegen/builtins/declarations.ts";
import * as b from "../../../src/codegen/builtins/lib.ts";
import type { ModelBuiltin, ModelModule } from "../../../src/codegen/builtins/model.ts";
import { engineDirectory, engineFiles as generated, generatorEnv } from "./engine-files.ts";

const bunRoot = resolve(import.meta.dir, "..", "..", "..");
const path = "process.member";

const writtenIn = (file: string, declarations: readonly Declaration[]): SourcedDeclaration[] =>
  declarations.map(declaration => ({
    declaration,
    source: { file, line: null, origin: "Host", proof: "HandWritten" },
  }));

const madeByTable: SourcedDeclaration = {
  declaration: {
    declares: "Member",
    path,
    kind: "Function",
    isOwnPropertyOfInstances: false,
    isLazilyCreated: false,
    signatures: [],
    dispatches: [],
    constant: null,
    length: 1,
    columns: {},
  },
  source: { file: "BunProcess.cpp", line: 7, origin: "Host", proof: "Structure" },
};

function build(...rows: readonly SourcedDeclaration[]): ModelBuilder {
  const builder = new ModelBuilder({ schema: {} as Schema, engineFiles: [] });
  buildEntries(builder, [
    ...writtenIn("globals.ts", b.namespace("globalThis", {}, { isGlobalObject: true })),
    ...writtenIn("globals.ts", b.namespace("process", {})),
    ...rows,
  ]);
  return builder;
}

test("what native code makes as a function is a function, which a call calls", () => {
  const builder = build(madeByTable);
  expect(builder.problems.lines).toEqual([]);
  expect(builder.find(path)).toMatchObject({ kind: "Function", mutability: "ConstantUnlessWritten" });
});

test("nobody writes a property that holds anything over a function that native code makes", () => {
  expect(build(madeByTable, ...writtenIn("values.ts", b.static(path, b.property(b.any)))).problems.lines).toEqual([
    `values.ts: ${path} is written as a property that holds anything, and BunProcess.cpp makes a Function there: a read of it answers that object`,
  ]);
});

test("a property that says what it holds may stand over such a function", () => {
  const builder = build(madeByTable, ...writtenIn("values.ts", b.static(path, b.property(b.callable))));
  expect(builder.problems.lines).toEqual([]);
  expect(builder.find(path)?.kind).toBe("DataProperty");
});

function exportsOf(specifier: string): Map<string, MemberDeclaration> {
  const problems = new Problems();
  const members = collectModules(bunRoot, [], problems).flatMap(({ declaration }) =>
    declaration.declares === "Member" && declaration.path.startsWith(`${specifier}.`) ? [declaration] : [],
  );
  expect(problems.lines).toEqual([]);
  return new Map(members.map(member => [member.path.slice(specifier.length + 1), member]));
}

test("an export that putNativeFn() makes is a function", () => {
  const exports = exportsOf("bun:jsc");
  const properties = [...exports].filter(([, { kind }]) => kind !== "Function").map(([name]) => name);
  expect(properties).toEqual(["default"]);
  expect(exports.get("serialize")).toMatchObject({ kind: "Function", length: 1, signatures: [] });
});

test("an export out of a table of numbers is a number", () => {
  const exports = exportsOf("node:constants");
  expect(exports.get("O_RDONLY")).toMatchObject({
    kind: "DataProperty",
    signatures: [{ mode: "Get", result: b.f64.spec }],
  });
  expect(exports.get("defaultCipherList")).toMatchObject({ kind: "DataProperty", signatures: [] });
});

test("an export of a module written in JavaScript stays a name: its value is read off the code", () => {
  expect(exportsOf("node:v8").get("serialize")).toMatchObject({ kind: "DataProperty", signatures: [] });
});

const reads = (isAnything: boolean) => [{ mode: "Get", result: { type: { isAnything } } }];
const entry = (kind: string, holder: ModelBuiltin | null, isAnything: boolean) =>
  ({ kind, holder, overloads: reads(isAnything) }) as unknown as ModelBuiltin;

test("the count takes the properties of native code of which nothing is written, and no others", () => {
  const native = entry("Namespace", null, false);
  const source = entry("Namespace", null, false);
  const counted = entry("DataProperty", native, true);
  const builtins = [
    counted,
    entry("DataProperty", native, false),
    entry("Accessor", native, true),
    entry("DataProperty", source, true),
  ];
  const modules = [
    { hasSource: false, namespace: native },
    { hasSource: true, namespace: source },
  ] as ModelModule[];
  expect(undescribedProperties({ builtins, modules })).toEqual([counted]);
});

// It goes down with each property that somebody describes, and then so does this number. One that goes up is a property that a program reads as a value nobody knows.
const mostUndescribedProperties = 140;

test.skipIf(generated === undefined)(
  "no property that native code fills has been added without its value",
  async () => {
    const schemas = globAllSources().bindgen;
    const testSchemas = schemas.filter(schema => schema.endsWith("_test.bind.ts")).map(schema => basename(schema));
    using directory = tempDir("builtins-table", {});
    await using generator = Bun.spawn({
      cmd: [
        bunExe(),
        join(bunRoot, "src", "codegen", "builtins", "index.ts"),
        `--codegen-path=${directory}`,
        "--target=Linux",
        `--sources=${schemas.map(schema => `${crateOf(schema)}=${schema}`).join(",")}`,
        `--prebuilt-generated=${generated}`,
        `--engine-directory=${engineDirectory}`,
        `--types-only=${testSchemas.join(",")}`,
      ],
      cwd: bunRoot,
      env: generatorEnv,
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stderr, exitCode] = await Promise.all([generator.stderr.text(), generator.exited]);
    const errors = stderr.split("\n").filter(line => line !== "" && !line.startsWith("builtins table:"));
    expect({ errors, exitCode }).toEqual({ errors: [], exitCode: 0 });
    const count = /(\d+) properties that native code fills hold a value that is not described/.exec(stderr)?.[1];
    expect(Number(count)).toBeLessThanOrEqual(mostUndescribedProperties);
  },
  isASAN ? 300_000 : 120_000,
);
