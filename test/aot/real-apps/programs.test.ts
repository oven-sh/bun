import { expect } from "bun:test";
import { cpSync } from "fs";
import { bunEnv, bunExe, tempDir } from "harness";
import { join } from "path";
import { describe, test } from "../supported";

type Mode = "bun run --aot" | "bun build --compile --aot";
const programs: { file: string; shapeOf: string; expected: string; differs: Mode[] }[] = [
  {
    file: "type-guard-casts-before-it-tests.ts",
    shapeOf: "ts-pattern",
    expected: "false false true\n",
    differs: ["bun build --compile --aot"],
  },
  {
    file: "handler-called-with-part-of-its-context.ts",
    shapeOf: "Elysia",
    expected: "/\n",
    differs: ["bun build --compile --aot"],
  },
  {
    file: "overload-wider-than-its-implementation.ts",
    shapeOf: "Redux Toolkit",
    expected: "made\n",
    differs: ["bun run --aot", "bun build --compile --aot"],
  },
  {
    file: "draft-proxy-stands-for-an-array.ts",
    shapeOf: "immer",
    expected: "true 2 true\n1,2\n",
    differs: ["bun run --aot", "bun build --compile --aot"],
  },
  {
    file: "cast-to-array-like-converts-primitives.ts",
    shapeOf: "es-toolkit",
    expected: "false false false true\n  a,b\n",
    differs: [],
  },
  {
    file: "constructor-of-a-generator-object.ts",
    shapeOf: "Elysia",
    expected: "a string\nan array\nsomething else: object\nsomething else: object\nsomething else: undefined\n",
    differs: [],
  },
  {
    file: "argument-bound-by-conditional-type-over-optional-member.ts",
    shapeOf: "the MCP SDK",
    expected: "true\n",
    differs: [],
  },
  { file: "conditional-bound-read-with-a-default.ts", shapeOf: "the MCP SDK", expected: '{"a":1}\n', differs: [] },
];

async function run(cmd: string[], cwd: string) {
  await using proc = Bun.spawn({ cmd, cwd, env: bunEnv, stdout: "pipe", stderr: "pipe" });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  return { stdout, stderr, exitCode };
}

function copy() {
  const dir = tempDir("aot-real-apps-programs", {});
  cpSync(join(import.meta.dir, "programs"), String(dir), { recursive: true });
  return dir;
}

for (const { file, shapeOf, expected, differs } of programs) {
  describe(`${file} (the shape of code in ${shapeOf})`, () => {
    test("type checks, and plain Bun runs it", async () => {
      using dir = copy();
      expect(await run([bunExe(), "check", "--pretty", "false", file], String(dir))).toMatchObject({
        stdout: "",
        exitCode: 0,
      });
      expect(await run([bunExe(), "run", file], String(dir))).toMatchObject({ stdout: expected, exitCode: 0 });
    });

    (differs.includes("bun run --aot") ? test.failing : test)(
      "bun run --aot prints what plain Bun prints",
      async () => {
        using dir = copy();
        expect(await run([bunExe(), "run", "--aot", file], String(dir))).toMatchObject({
          stdout: expected,
          exitCode: 0,
        });
      },
    );

    (differs.includes("bun build --compile --aot") ? test.failing : test)(
      "the executable prints what plain Bun prints",
      async () => {
        using dir = copy();
        expect(
          await run([bunExe(), "build", "--compile", "--aot", file, "--outfile", "program"], String(dir)),
        ).toMatchObject({ exitCode: 0 });
        expect(await run([join(String(dir), "program")], String(dir))).toMatchObject({ stdout: expected, exitCode: 0 });
      },
      120_000,
    );
  });
}
