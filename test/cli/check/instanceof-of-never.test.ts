import { afterAll, expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { endChildren, spawn } from "../children";

afterAll(endChildren);

const tsconfig = JSON.stringify({ compilerOptions: { strict: true, noEmit: true, types: [] }, include: ["*.ts"] });

async function check(source: string) {
  using dir = tempDir("check-instanceof-of-never", { "tsconfig.json": tsconfig, "a.ts": source });
  await using proc = spawn({
    cmd: [bunExe(), "check", "--no-pretty"],
    cwd: String(dir),
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  return { errors: (stdout + stderr).match(/\(\d+,\d+\): error TS\d+/g) ?? [], exitCode };
}

const inside = (parameter: string, guard: string, statement: string) =>
  `export function run(c: boolean, a: ${parameter}) {\n  if (${guard}) {\n    ${statement}\n  }\n}\n`;

// The answers are those of tsc 6.0.3 and of TypeScript 7.0.2.
test.concurrent.each([
  ["the condition of a loop", "string", 'typeof a === "number"', "do { if (c) { } } while (a instanceof Date);", []],
  ["the body of a loop", "string", 'typeof a === "number"', "while (c) { if (c) { } if (a instanceof Date) { } }", []],
  ["an object", "{ x: 1 }", 'typeof a === "number"', "do { if (c) { } } while (a instanceof Date);", []],
  ["no loop", "string", 'typeof a === "number"', "if (a instanceof Date) { }", ["(3,9): error TS2358"]],
  ["no loop and an object", "{ x: 1 }", 'typeof a === "number"', "if (a instanceof Date) { }", ["(3,9): error TS2358"]],
  [
    "a loop without a join",
    "string",
    'typeof a === "number"',
    "do { } while (a instanceof Date);",
    ["(3,19): error TS2358"],
  ],
  [
    "a loop that begins with the test",
    "string",
    'typeof a === "number"',
    "while (a instanceof Date) { if (c) { } }",
    ["(3,12): error TS2358"],
  ],
  ["nothing narrowed", "string", "c", "do { if (c) { } } while (a instanceof Date);", ["(3,30): error TS2358"]],
  ["a parameter of type never", "never", "c", "do { if (c) { } } while (a instanceof Date);", ["(3,30): error TS2358"]],
] as const)("%s", async (_, parameter, guard, statement, expected) => {
  expect(await check(inside(parameter, guard, statement))).toEqual({
    errors: [...expected],
    exitCode: expected.length === 0 ? 0 : 1,
  });
});
