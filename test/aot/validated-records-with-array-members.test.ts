// Which parts of a typed result the generic validator and parser take over is in --explain=missed-optimizations. A record with array members has no such part:
// programs/data-from-outside/validated-records-with-array-members.ts is validated and parsed by compiled code throughout. A union that could try two
// recursive arms has one, and the report says why.
import { expect } from "bun:test";
import { bunEnv, bunExe, isWindows, tempDir } from "harness";
import { join } from "node:path";
import { test } from "./supported";

async function declinesOf(entryPoint: string, folder: string): Promise<string[]> {
  await using build = Bun.spawn({
    cmd: [bunExe(), "build", "--compile", "--aot", "--explain=missed-optimizations", entryPoint, "--outfile", join(folder, "main" + (isWindows ? ".exe" : ""))],
    cwd: folder,
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stderr, exitCode] = await Promise.all([build.stderr.text(), build.exited]);
  expect(stderr).toContain("missed optimizations: ");
  expect(exitCode).toBe(0);
  return stderr.split("\n").filter(line => line.includes("generic-validator"));
}

test("no part of a record with array members goes to the generic code", async () => {
  using dir = tempDir("aot-validated-array-members", {});
  expect(await declinesOf(join(import.meta.dir, "programs", "data-from-outside", "validated-records-with-array-members.ts"), String(dir))).toEqual([]);
}, 120_000);

test("a union that could try two recursive arms is reported with its cause", async () => {
  using dir = tempDir("aot-validated-recursive-union", {
    "main.ts": `
import { validate } from "bun:bundle";
interface Left { left?: Tree } interface Right { right?: Tree }
type Tree = Left | Right;
console.log(JSON.stringify(validate<{ tree: Tree }>({ tree: { left: { right: {} } } })));
`,
  });
  const lines = await declinesOf("main.ts", String(dir));
  expect(lines.filter(line => line.includes("missed: ")).map(line => line.replace(/^.*missed: /, ""))).toEqual([
    expect.stringMatching(/^generic-validator at main\.ts:\d+:\d+, two members of a union are both recursive$/),
  ]);
}, 120_000);
