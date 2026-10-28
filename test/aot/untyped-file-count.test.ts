import { expect } from "bun:test";
import { bunExe, isWindows, tempDir } from "harness";
import { join } from "node:path";
import { run } from "./harness/run";
import { test } from "./supported";

async function build(files: Record<string, string>) {
  using dir = tempDir("aot-compiled-untyped-count", files);
  const outfile = join(String(dir), "out" + (isWindows ? ".exe" : ""));
  const { stdout, stderr, exitCode } = await run(
    [bunExe(), "build", "--compile", "--aot", "./main.ts", "--outfile", outfile],
    String(dir),
  );
  return { line: stdout.split("\n").find(line => line.includes(" compile ")) ?? "", stderr, exitCode };
}

test("a package's file with type errors is counted on the compile line", async () => {
  const built = await build({
    "main.ts": `import { twice } from "wrong"; console.log(twice(2));`,
    "node_modules/wrong/package.json": `{ "name": "wrong", "version": "1.0.0", "main": "index.ts" }`,
    "node_modules/wrong/index.ts": `export function twice(n: number): number { const text: string = n; return n * 2; }`,
  });
  expect(built.stderr).toContain("TS100009");
  expect({ counted: built.line.includes("1 file compiled without types"), exitCode: built.exitCode }).toEqual({
    counted: true,
    exitCode: 0,
  });
}, 120_000);

test("a warning of another kind that quotes the words is not", async () => {
  const built = await build({
    "main.ts": `if (process.argv.length > 9) Math.max = () => "1 file compiled without types".length;\nconsole.log("built");`,
  });
  expect(built.stderr).toContain("warn: TS100014");
  expect(built.stderr).toContain("1 file compiled without types");
  expect(built.stderr).not.toContain("TS100009");
  expect({
    line: built.line.replace(/^.* compile /, "").includes("compiled without types"),
    exitCode: built.exitCode,
  }).toEqual({ line: false, exitCode: 0 });
}, 120_000);
