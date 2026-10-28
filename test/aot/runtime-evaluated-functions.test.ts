import { expect } from "bun:test";
import { bunExe, isWindows, tempDir } from "harness";
import { join } from "node:path";
import { run as runCommand } from "./harness/run";
import { openTypesFlags } from "./open-types";
import { test } from "./supported";

const library = (text: string) => `export interface Context {
  body: unknown;
  query: Record<string, string>;
  path: string;
}
export type Handler = (context: Context) => unknown;
export const handlers: Handler[] = [];
export function get(handler: Handler): void {
  handlers.push(handler);
}
export const compose = ${text} as (handler: Handler) => () => unknown;
`;
const fromConstructor = library(`new Function("handler", "return () => handler({ path: '/' })")`);
const application = `import { compose, get, handlers } from "./lib";\nget(({ path }) => path);\nconsole.log(compose(handlers[0]!)());\n`;
const another = `import { get } from "./lib";\nget(({ path }) => path);\n`;

async function run(files: Record<string, string>, entryPoint: string) {
  using dir = tempDir("aot-runtime-evaluated-functions", {
    "tsconfig.json": JSON.stringify({ compilerOptions: { strict: true, allowJs: true } }),
    ...files,
  });
  const directory = String(dir);
  const outfile = join(directory, "out" + (isWindows ? ".exe" : ""));
  const {
    stdout: out,
    stderr: err,
    exitCode,
  } = await runCommand(
    [bunExe(), "build", "--compile", "--aot", ...openTypesFlags, entryPoint, "--outfile", outfile],
    directory,
  );
  expect({ exitCode, output: exitCode ? out + err : "" }).toEqual({ exitCode: 0, output: "" });
  const { stdout, stderr, exitCode: ended } = await runCommand([outfile], directory);
  return { stdout, stderr, exitCode: ended, buildOutput: out + err };
}
const prints = (stdout: string) => expect.objectContaining({ stdout, stderr: "", exitCode: 0 });
// `aot: unknown-code: called-by-unknown-code at app.ts:2:43, 1 access, why called-by-runtime-code`
const explained = (output: string) =>
  [...output.matchAll(/^aot: (?:unknown-code|unproven-type): ([a-z-]+) at (.+?):(\d+):\d+,/gm)].map(
    ([, code, file, line]) => `${code} at ${file}:${line}`,
  );

test("a handler accepts an object with missing fields in a program with an unchecked or a JavaScript module", async () => {
  for (const [name, text] of [
    ["more.ts", "// @ts-nocheck\n" + another],
    ["more.js", another],
  ] as const) {
    const entry = `import "./app";\nimport "./${name}";\n`;
    expect(
      await run({ "lib.ts": fromConstructor, "app.ts": application, [name]: text, "entry.ts": entry }, "./entry.ts"),
    ).toEqual(prints("/\n"));
  }
}, 240_000);

test("a handler passed to a function created from text accepts an object with missing fields", async () => {
  const app = `import { compose, type Context } from "./lib";\nconsole.log(compose((context: Context) => context.path)());\n`;
  expect(await run({ "lib.ts": fromConstructor, "app.ts": app }, "./app.ts")).toEqual(prints("/\n"));
}, 120_000);

test("a handler passed to a function created from text that the build cannot read accepts an object with missing fields", async () => {
  const fromUnknownText = library(
    `new Function("handler", process.argv[2] ?? ["return () => handler({ path:", "'/' })"].join(" "))`,
  );
  const app = `import { compose, type Context } from "./lib";\nconsole.log(compose((context: Context) => context.path)());\n`;
  const ran = await run({ "lib.ts": fromUnknownText, "app.ts": app }, "./app.ts");
  expect(ran).toEqual(prints("/\n"));
  expect(explained(ran.buildOutput)).toContain("called-by-unknown-code at app.ts:2");
}, 120_000);

test("a handler passed to a function created by eval accepts an object with missing fields", async () => {
  const fromEval = library(`(0, eval)("(handler) => () => handler({ path: '/' })")`);
  expect(
    await run(
      {
        "lib.ts": fromEval,
        "app.ts": `import { compose } from "./lib";\nconsole.log(compose(({ path }) => path)());\n`,
      },
      "./app.ts",
    ),
  ).toEqual(prints("/\n"));
}, 120_000);

test("a handler accepts an object with every declared field", async () => {
  const complete = library(`new Function("handler", "return () => handler({ body: 1, query: {}, path: '/' })")`);
  expect(await run({ "lib.ts": complete, "app.ts": application }, "./app.ts")).toEqual(prints("/\n"));
}, 120_000);

test("a program's own function named Function is not the Function constructor", async () => {
  const app = `import type { Context, Handler } from "./lib";
function Function(handler: Handler): () => unknown {
  return () => handler({ body: 1, query: {}, path: "/" });
}
console.log(Function((context: Context) => context.path)());
interface Control {
  control: number;
}
const control: Control = JSON.parse('{"control":1}');
console.log(control.control);
`;
  const ran = await run(
    { "lib.ts": library("((handler: Handler) => () => handler({ body: 1, query: {}, path: '/' }))"), "app.ts": app },
    "./app.ts",
  );
  expect(ran).toEqual(prints("/\n1\n"));
  // Only the parsed data is explained, which shows that the report is read. Nothing is said of the handler's parameter.
  expect(explained(ran.buildOutput)).toEqual(["unknown-object at app.ts:9"]);
}, 120_000);
