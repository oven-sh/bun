// A function whose last act is to call itself needs no call: the arguments become the parameters and the body starts again. The build counts the calls that it has turned
// into jumps, and --explain=statistics prints the count. The front end writes every call of a program as a call of a value, so the pass has to look where calls name their callees.
import { expect } from "bun:test";
import { bunEnv, bunExe, isWindows, tempDir } from "harness";
import { join } from "node:path";
import { test } from "./supported";

test("a typed and an untyped function that end in a call of themselves become loops", async () => {
  using dir = tempDir("aot-tail-recursion", {
    "untyped.js": `export function sumUntyped(n, acc) { return n === 0 ? acc : sumUntyped(n - 1, acc + n); }\n`,
    "main.ts": `
import { sumUntyped } from "./untyped.js";
declare const console: { log(...values: unknown[]): void };
function sum(n: number, acc: number): number { return n === 0 ? acc : sum(n - 1, acc + n); }
console.log(sum(100000, 0), sumUntyped(100000, 0));
`,
  });
  const executable = join(String(dir), "main" + (isWindows ? ".exe" : ""));
  await using build = Bun.spawn({
    cmd: [bunExe(), "build", "--compile", "--aot", "--explain=statistics", "main.ts", "--outfile", executable],
    cwd: String(dir),
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stderr, exitCode] = await Promise.all([build.stderr.text(), build.exited]);
  // Bun's own modules may add to the count.
  const eliminated = Number(/^TailRecursionsEliminated (\d+)$/m.exec(stderr)?.[1] ?? 0);
  expect(eliminated).toBeGreaterThanOrEqual(2);
  expect(exitCode).toBe(0);

  await using run = Bun.spawn({ cmd: [executable], env: bunEnv, stdout: "pipe", stderr: "pipe" });
  expect(await run.stdout.text()).toBe("5000050000 5000050000\n");
  expect(await run.exited).toBe(0);
}, 120_000);
