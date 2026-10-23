import { expect } from "bun:test";
import { cpSync } from "fs";
import { bunExe, tempDir } from "harness";
import { join } from "path";
import { run } from "../harness/run";
import { describe, test } from "../supported";

const programs: { file: string; shapeOf: string; expected: string }[] = [
  { file: "type-guard-casts-before-it-tests.ts", shapeOf: "ts-pattern", expected: "false false true\n" },
  { file: "handler-called-with-part-of-its-context.ts", shapeOf: "Elysia", expected: "/\n" },
  { file: "overload-wider-than-its-implementation.ts", shapeOf: "Redux Toolkit", expected: "made\n" },
  { file: "draft-proxy-stands-for-an-array.ts", shapeOf: "immer", expected: "true 2 true\n1,2\n" },
  {
    file: "cast-to-array-like-converts-primitives.ts",
    shapeOf: "es-toolkit",
    expected: "false false false true\n  a,b\n",
  },
  {
    file: "constructor-of-a-generator-object.ts",
    shapeOf: "Elysia",
    expected: "a string\nan array\nsomething else: object\nsomething else: object\nsomething else: undefined\n",
  },
  { file: "argument-bound-by-conditional-type-over-optional-member.ts", shapeOf: "the MCP SDK", expected: "true\n" },
  { file: "conditional-bound-read-with-a-default.ts", shapeOf: "the MCP SDK", expected: '{"a":1}\n' },
  { file: "object-from-entries-returned-as-a-mapped-type.ts", shapeOf: "MikroORM", expected: "14 0 13\n" },
];

function copy() {
  const dir = tempDir("aot-real-apps-programs", {});
  cpSync(join(import.meta.dir, "programs"), String(dir), { recursive: true });
  return dir;
}

for (const { file, shapeOf, expected } of programs) {
  describe(`${file} (the shape of code in ${shapeOf})`, () => {
    test("type checks, and plain Bun runs it", async () => {
      using dir = copy();
      expect(await run([bunExe(), "check", "--pretty", "false", file], String(dir))).toMatchObject({
        stdout: "",
        exitCode: 0,
      });
      expect(await run([bunExe(), "run", file], String(dir))).toMatchObject({ stdout: expected, exitCode: 0 });
    });

    test.each(["--aot", "--debug-aot"])("bun run %s prints what plain Bun prints", async flag => {
      using dir = copy();
      expect(await run([bunExe(), "run", flag, file], String(dir))).toMatchObject({ stdout: expected, exitCode: 0 });
    });

    test("the executable prints what plain Bun prints", async () => {
      using dir = copy();
      expect(
        await run([bunExe(), "build", "--compile", "--aot", file, "--outfile", "program"], String(dir)),
      ).toMatchObject({ exitCode: 0 });
      expect(await run([join(String(dir), "program")], String(dir))).toMatchObject({ stdout: expected, exitCode: 0 });
    }, 120_000);
  });
}
