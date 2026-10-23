// `bun check` accepts the calls that `bun run` validates, JSON.parse<T>(text) and validate<T>(value), and the types of the
// namespace `Schema`, whatever types of Bun are installed. No other call takes a type argument that its declaration does not have.
//
// TODO: that is the design from before the type argument of the global JSON.parse became something a project asks for
// (`/// <reference types="bun-types/aot" />`, or `import { JSON } from "bun"`: docs/bundler/validate.mdx, "Types in your editor"). A build knows the
// type argument by itself; `bun check` learns it from the installed types, as tsc does, and says TS2558 without them. The tests that state the old design are todo.
import { expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { join } from "node:path";

const options = (more: object) =>
  JSON.stringify({
    compilerOptions: {
      strict: true,
      noEmit: true,
      target: "esnext",
      module: "esnext",
      moduleResolution: "bundler",
      lib: ["esnext"],
      ...more,
    },
  });

const olderTypes = {
  "types/bun/package.json": JSON.stringify({ name: "@types/bun", version: "1.0.0", types: "index.d.ts" }),
  "types/bun/index.d.ts": `/// <reference path="./bun.ns.d.ts" />\ndeclare module "bun" { function inspect(value: unknown): string; }\n`,
  "types/bun/bun.ns.d.ts": `import * as BunModule from "bun";\ndeclare global { export import Bun = BunModule; }\n`,
};
const worlds: Record<string, Record<string, string>> = {
  "no types of Bun": { "tsconfig.json": options({ typeRoots: ["./no-types-here"] }) },
  "types of Bun from before these calls": {
    "tsconfig.json": options({ typeRoots: ["./types"], types: ["bun"], skipLibCheck: false }),
    ...olderTypes,
  },
  "the types of Bun of this repository": {
    "tsconfig.json": options({
      typeRoots: [join(import.meta.dir, "..", "..", "..", "packages")],
      types: ["bun-types"],
      skipLibCheck: true,
    }),
  },
};

const validates = `
import type { Schema } from "bun";
import { JSON as Codec } from "bun";
import { validate } from "bun:bundle";
interface User {
  id: number & Schema.Int & Schema.Min<1>;
  name: string & Schema.MinLength<1>;
}
export const parsed: User = JSON.parse<User>('{"id":7,"name":"Ada"}');
export const revived: User = JSON.parse<User>('{"id":7,"name":"Ada"}', (key, value) => value);
export const validated: User = validate<User>({ id: 7, name: "Ada" });
export const imported: User = Codec.parse<User>('{"id":7,"name":"Ada"}');
export const issuesOf = (error: Schema.Error): Schema.Issue[] => error.issues;
`;

const usesGlobalBun = `interface User {
  name: string & Bun.Schema.MinLength<1>;
}
export const user: User = Bun.JSON.parse<User>('{"name":"Ada"}');
`;

const takesNoTypeArgument = `export const text = JSON.stringify<{ a: number }>({ a: 1 });
export const throughGlobalThis = globalThis.JSON.parse<{ a: number }>("{}");
const own = { parse: (text: string) => text };
export const ofItsOwn = own.parse<string>("{}");
export const two = JSON.parse<{ a: number }, string>("{}");
export const isWhatIsWritten: string = JSON.parse<{ a: number }>("{}");
`;

const cannotFindBun =
  "error TS2868: Cannot find name 'Bun'. Do you need to install type definitions for Bun? Try `bun add -d @types/bun` and then add 'bun' to the types field in your tsconfig.";

async function check(files: Record<string, string>, ...args: string[]) {
  using dir = tempDir("check-validation-by-type", files);
  await using checked = Bun.spawn({
    cmd: [bunExe(), "check", ...args],
    cwd: String(dir),
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([checked.stdout.text(), checked.stderr.text(), checked.exited]);
  return { stdout: stdout.trim().split("\n"), stderr, exitCode };
}

for (const [world, files] of Object.entries(worlds)) {
  test.todo(`with ${world}: what validates is accepted`, async () => {
    expect(await check({ ...files, "validates.ts": validates })).toMatchObject({ stdout: [""], exitCode: 0 });
  });

  (world === "types of Bun from before these calls" ? test.todo : test.concurrent)(
    `with ${world}: the global Bun is declared only by installed types`,
    async () => {
      const expected =
        world === "no types of Bun"
          ? {
              stdout: ["a.ts(2,18): error TS2503: Cannot find namespace 'Bun'.", "a.ts(4,27): " + cannotFindBun],
              exitCode: 1,
            }
          : { stdout: [""], exitCode: 0 };
      expect(await check({ ...files, "a.ts": usesGlobalBun })).toMatchObject(expected);
    },
  );

  test.todo(`with ${world}: no other call takes the type argument`, async () => {
    expect(await check({ ...files, "a.ts": takesNoTypeArgument })).toMatchObject({
      stdout: [
        "a.ts(1,36): error TS2558: Expected 0 type arguments, but got 1.",
        "a.ts(2,56): error TS2558: Expected 0 type arguments, but got 1.",
        "a.ts(4,35): error TS2558: Expected 0 type arguments, but got 1.",
        "a.ts(5,31): error TS2558: Expected 0 type arguments, but got 2.",
        "a.ts(6,14): error TS2322: Type '{ a: number; }' is not assignable to type 'string'.",
      ],
      exitCode: 1,
    });
  });

  test.todo(`with ${world}: what Bun brings along is in no list of files`, async () => {
    for (const flag of ["--listFiles", "--explainFiles", "--traceResolution"]) {
      const { stdout, exitCode } = await check(
        { ...files, "a.ts": `export const a = JSON.parse<{ a: number }>("{}");\n` },
        flag,
      );
      expect({ flag, broughtAlong: stdout.filter(line => line.includes("$bun")), exitCode }).toEqual({
        flag,
        broughtAlong: [],
        exitCode: 0,
      });
    }
  });
}

test("without the types of Bun, the global Bun is not found, and the note says how to get them", async () => {
  const { stdout, stderr, exitCode } = await check({
    ...worlds["no types of Bun"],
    "a.ts": `export const server = Bun.serve({});\n`,
  });
  expect({ stdout, exitCode }).toEqual({ stdout: ["a.ts(1,23): " + cannotFindBun], exitCode: 1 });
  expect(stderr).toContain(
    "note: Bun's type definitions (console, fetch, Bun, bun:test) are not installed. Run: bun add -d @types/bun",
  );
});

test("types of Bun that tsconfig.json leaves out stay out", async () => {
  const tsconfig = JSON.stringify({ ...JSON.parse(options({ typeRoots: ["./types"], types: [] })), files: ["a.ts"] });
  const files = { "tsconfig.json": tsconfig, ...olderTypes, "a.ts": `export const shown = Bun.inspect(1);\n` };
  const { stdout, stderr, exitCode } = await check(files);
  expect({ stdout, exitCode }).toEqual({ stdout: ["a.ts(1,22): " + cannotFindBun], exitCode: 1 });
  expect(stderr).toContain(
    "note: Bun's type definitions (console, fetch, Bun, bun:test) are installed, but tsconfig.json does not include them.",
  );
});

test("a global Bun that the project declares is the project's", async () => {
  for (const declaration of [
    `declare var Bun: { answer: 42 };\n`,
    `export {};\ndeclare global {\n  var Bun: { answer: 42 };\n}\n`,
  ]) {
    const files = {
      ...worlds["no types of Bun"],
      "bun.d.ts": declaration,
      "a.ts": `export const answer: 42 = Bun.answer;\n`,
    };
    expect(await check(files)).toMatchObject({ stdout: [""], exitCode: 0 });
  }
});

test.todo("the rules of bun lint that need types see the type that is written, not any", async () => {
  using dir = tempDir("lint-validation-by-type", {
    ...worlds["no types of Bun"],
    "a.ts": `interface User {\n  name: string;\n}\nexport function nameIn(text: string) {\n  const user = JSON.parse<User>(text);\n  return user.name;\n}\n`,
  });
  const rules = ["no-unsafe-assignment", "no-unsafe-member-access", "no-unsafe-return"].flatMap(rule => [
    "--rule",
    `typescript/${rule}: error`,
  ]);
  await using linted = Bun.spawn({
    cmd: [bunExe(), "lint", "--type-aware", ...rules, "a.ts"],
    cwd: String(dir),
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([linted.stdout.text(), linted.stderr.text(), linted.exited]);
  expect({ said: exitCode ? stdout + stderr : "", exitCode }).toEqual({ said: "", exitCode: 0 });
});
