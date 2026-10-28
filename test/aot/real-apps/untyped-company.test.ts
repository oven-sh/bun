import { expect } from "bun:test";
import { bunExe, tempDir } from "harness";
import { join } from "path";
import { run } from "../harness/run";
import { describe, test } from "../supported";

const registersAnotherHandler = `import { get } from "./library";
get(({ path }) => path);
`;

const files = {
  "tsconfig.json": JSON.stringify({
    compilerOptions: {
      target: "esnext",
      module: "preserve",
      moduleResolution: "bundler",
      moduleDetection: "force",
      strict: true,
      noEmit: true,
      lib: ["esnext", "dom"],
      types: [],
    },
  }),
  "library.ts": `export interface Context {
  body: unknown;
  query: Record<string, string>;
  path: string;
}
export type Handler = (context: Context) => unknown;
export const handlers: Handler[] = [];
export function get(handler: Handler): void {
  handlers.push(handler);
}
export const compose = new Function("handler", "return () => handler({ path: '/' })") as (handler: Handler) => () => unknown;
`,
  "app.ts": `import { compose, get, handlers } from "./library";
get(({ path }) => path);
console.log(compose(handlers[0]!)());
`,
  "typed.ts": registersAnotherHandler,
  "unchecked.ts": "// @ts-nocheck\n" + registersAnotherHandler,
  "javascript.js": registersAnotherHandler,
  "alone.ts": `import "./app";
`,
  "with-typed-module.ts": `import "./app";
import "./typed";
`,
  "with-unchecked-module.ts": `import "./app";
import "./unchecked";
`,
  "with-javascript-module.ts": `import "./app";
import "./javascript.js";
`,
};

async function runExecutable(cwd: string, entry: string) {
  expect(await run([bunExe(), "build", "--compile", "--aot", entry, "--outfile", "program"], cwd)).toMatchObject({
    exitCode: 0,
  });
  const { stdout, exitCode } = await run([join(cwd, "program")], cwd);
  return { stdout, exitCode };
}

describe("a typed handler that generated code calls with part of its context (the shape of code in Elysia)", () => {
  const entries = ["alone.ts", "with-typed-module.ts", "with-unchecked-module.ts", "with-javascript-module.ts"];
  const executables = new Map<string, { stdout: string; exitCode: number }>();

  test("plain Bun prints the path in all four programs", async () => {
    using dir = tempDir("aot-untyped-company", files);
    for (const entry of entries)
      expect(await run([bunExe(), "run", entry], String(dir))).toMatchObject({ stdout: "/\n", exitCode: 0 });
  });

  test("all four programs build", async () => {
    using dir = tempDir("aot-untyped-company", files);
    for (const entry of entries) executables.set(entry, await runExecutable(String(dir), entry));
  }, 240_000);

  for (const entry of entries)
    test(`the executable of ${entry} prints the path`, () => {
      expect(executables.get(entry)).toEqual({ stdout: "/\n", exitCode: 0 });
    });
});
