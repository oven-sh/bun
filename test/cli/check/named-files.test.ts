import { expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";

const tsconfig = JSON.stringify({ compilerOptions: { strict: true, noEmit: true, types: [] }, include: ["*.ts"] });

async function check(files: Record<string, string>, ...named: string[]) {
  using dir = tempDir("check-named-files", { "tsconfig.json": tsconfig, ...files });
  await using proc = Bun.spawn({
    cmd: [bunExe(), "check", "--no-pretty", ...named],
    cwd: String(dir),
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr] = await Promise.all([proc.stdout.text(), proc.stderr.text()]);
  return { errors: (stdout + stderr).match(/error TS\d+/g) ?? [], exitCode: await proc.exited };
}

const usesGlobal = "console.log(declaredElsewhere + 1);\n";

test.each([
  ["a script", { "script.ts": "var declaredElsewhere: number;\n" }],
  ["declare global", { "rest.ts": "export {};\ndeclare global { var declaredElsewhere: number; }\n" }],
  [
    "a file outside include that an unreached file imports",
    {
      "nobody.ts": `export function load() { return import("./outside/adds"); }\n`,
      "outside/adds.ts": "export {};\ndeclare global { var declaredElsewhere: number; }\n",
    },
  ],
  [
    "a file outside include behind an unreached file of the project",
    {
      "first.ts": `export * from "./second";\n`,
      "second.ts": `import "./outside/adds";\n`,
      "outside/adds.ts": "export {};\ndeclare global { var declaredElsewhere: number; }\n",
    },
  ],
  [
    "a reference",
    {
      "refers.ts": `/// <reference path="./outside/adds.d.ts" />\nexport {};\n`,
      "outside/adds.d.ts": "declare var declaredElsewhere: number;\n",
    },
  ],
])("a named file sees a global declared by %s", async (_, files) => {
  expect(await check({ "main.ts": usesGlobal, ...files }, "main.ts")).toEqual({ errors: [], exitCode: 0 });
});

test("a named file does not see a global of a module nothing reaches, or its errors", async () => {
  const unreached = "export const wrong: string = 1;\n";
  expect(await check({ "main.ts": "export const fine = 1;\n", "unreached.ts": unreached }, "main.ts")).toEqual({
    errors: [],
    exitCode: 0,
  });
});

test("a file that a named file imports is checked as before", async () => {
  const result = await check(
    { "main.ts": `import { a } from "./used";\nexport const b: string = a;\n`, "used.ts": "export const a = 1;\n" },
    "main.ts",
  );
  expect(result.errors).toEqual(["error TS2322"]);
});
