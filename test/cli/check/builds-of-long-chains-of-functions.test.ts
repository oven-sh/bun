// What a chain of functions takes more stack for than a worker has is found on the large stack of the last round, in a build too: 2,400 functions that each call the
// next in a callback stopped the build for want of stack, and the build of 4,800 had no end.
import { expect, test } from "bun:test";
import { bunEnv, bunExe, isASAN, isDebug, isWindows, tempDir } from "harness";
import { join } from "node:path";
import { run } from "../../aot/harness/run";

const buildAndRun = async (program: string) => {
  using dir = tempDir("check-builds-of-long-chains", { "main.ts": program });
  const outfile = join(String(dir), isWindows ? "out.exe" : "out");
  const built = await run(
    [bunExe(), "build", "--no-install", "--compile", "--aot", "./main.ts", `--outfile=${outfile}`],
    String(dir),
    bunEnv,
  );
  expect(built.stdout + built.stderr).not.toContain("ran out of stack");
  expect(built.exitCode).toBe(0);
  return (await run([outfile], String(dir), bunEnv)).stdout;
};

const lines = (size: number, line: (i: number) => string) =>
  Array.from({ length: size }, (_, i) => line(i) + "\n").join("");

// The frames of a debug build are several times as large.
const sizes = isDebug || isASAN ? [10] : [10, 2400, 4800];

test.concurrent.each(sizes)("%d functions that each call the next in a callback", async size => {
  const program =
    lines(size, i => `function f${i}(x: number) { return [x].map(y => f${i + 1}(y))[0]; }`) +
    `function f${size}(x: number) { return x; }\nconsole.log(f0(1));\n`;
  expect(await buildAndRun(program)).toBe("1\n");
});

test.concurrent.each(sizes)("%d functions that each call the next in a loop", async size => {
  const link = (i: number) =>
    `function f${i}(k: number) { let a = []; for (let i = 0; i < k; i++) { const t = f${i + 1}(k); a = a.concat(t); } return a; }`;
  expect(
    await buildAndRun(lines(size, link) + `function f${size}(k: number) { return [k]; }\nconsole.log(f0(1).length);\n`),
  ).toBe("1\n");
});
