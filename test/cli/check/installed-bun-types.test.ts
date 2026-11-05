// `bun check` gets the global `Bun` from the installed types and the global `JSON` from TypeScript's library.
import { expect, test } from "bun:test";
import { bunExe, tempDir } from "harness";
import { join } from "node:path";
import { run } from "../../aot/harness/run";

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

const smallTypes = {
  "types/bun/package.json": JSON.stringify({ name: "@types/bun", version: "1.0.0", types: "index.d.ts" }),
  "types/bun/index.d.ts": `/// <reference path="./bun.ns.d.ts" />\ndeclare module "bun" { function inspect(value: unknown): string; }\n`,
  "types/bun/bun.ns.d.ts": `import * as BunModule from "bun";\ndeclare global { export import Bun = BunModule; }\n`,
};
const worlds: Record<string, Record<string, string>> = {
  "no types of Bun": { "tsconfig.json": options({ typeRoots: ["./no-types-here"] }) },
  "a small @types/bun": {
    "tsconfig.json": options({ typeRoots: ["./types"], types: ["bun"], skipLibCheck: false }),
    ...smallTypes,
  },
  "the types of Bun of this repository": {
    "tsconfig.json": options({
      typeRoots: [join(import.meta.dir, "..", "..", "..", "packages")],
      types: ["bun-types"],
      skipLibCheck: true,
    }),
  },
};

const usesGlobalBun = `export const shown = Bun.inspect(1);\n`;

const passesTypeArguments = `export const text = JSON.stringify<{ a: number }>({ a: 1 });
export const throughGlobalThis = globalThis.JSON.parse<{ a: number }>("{}");
const own = { parse: (text: string) => text };
export const ofItsOwn = own.parse<string>("{}");
export const two = JSON.parse<{ a: number }, string>("{}");
export const isWhatIsWritten: string = JSON.parse<{ a: number }>("{}");
`;

const cannotFindBun =
  "error TS2868: Cannot find name 'Bun'. Do you need to install type definitions for Bun? Try `bun add -d @types/bun` and then add 'bun' to the types field in your tsconfig.";

async function check(files: Record<string, string>) {
  using dir = tempDir("check-installed-bun-types", files);
  const { stdout, stderr, exitCode } = await run([bunExe(), "check"], String(dir));
  return { stdout: stdout.trim().split("\n"), stderr, exitCode };
}

for (const [world, files] of Object.entries(worlds)) {
  test.concurrent(`with ${world}: the global Bun is declared only by installed types`, async () => {
    const expected =
      world === "no types of Bun"
        ? { stdout: ["a.ts(1,22): " + cannotFindBun], exitCode: 1 }
        : { stdout: [""], exitCode: 0 };
    expect(await check({ ...files, "a.ts": usesGlobalBun })).toMatchObject(expected);
  });

  test.concurrent(`with ${world}: JSON.parse and JSON.stringify take no type arguments`, async () => {
    expect(await check({ ...files, "a.ts": passesTypeArguments })).toMatchObject({
      stdout: [
        "a.ts(1,36): error TS2558: Expected 0 type arguments, but got 1.",
        "a.ts(2,56): error TS2558: Expected 0 type arguments, but got 1.",
        "a.ts(4,35): error TS2558: Expected 0 type arguments, but got 1.",
        "a.ts(5,31): error TS2558: Expected 0 type arguments, but got 2.",
        "a.ts(6,51): error TS2558: Expected 0 type arguments, but got 1.",
      ],
      exitCode: 1,
    });
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
  const files = { "tsconfig.json": tsconfig, ...smallTypes, "a.ts": usesGlobalBun };
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
