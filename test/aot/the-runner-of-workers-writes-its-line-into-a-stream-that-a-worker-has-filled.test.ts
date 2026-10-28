// programs/run-each-in-a-worker.ts writes a line behind what each Worker has printed. Its streams are sockets, which no longer block once a Worker has printed, and whoever reads them may
// be behind. Here a Worker fills its stream to the last byte while nobody reads.
import { expect } from "bun:test";
import { copyFileSync, writeFileSync } from "fs";
import { bunEnv, bunExe, isWindows, tempDir } from "harness";
import { join } from "path";
import { test } from "./supported";

const runner = "run-each-in-a-worker.ts";
const mark = "=== the program above has ended with";
const fills = `import { writeSync } from "node:fs";
// What is printed first makes the stream one that does not block.
process.stdout.write("it begins\\n");
await new Promise(resolve => setTimeout(resolve, 50));
let written = 0;
for (let size = 1 << 16; size > 0; size >>= 1) {
  const text = "x".repeat(size);
  // A stream that blocks all the same is never full.
  while (written < 1 << 24) {
    try {
      written += writeSync(1, text);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EAGAIN") throw error;
      break;
    }
  }
}
`;

test("the line stands behind the output of a Worker that has left no room for it", async () => {
  using dir = tempDir("aot-runner-full-stream", { "fills.ts": fills });
  const folder = String(dir);
  copyFileSync(join(import.meta.dir, "programs", runner), join(folder, runner));
  const executable = join(folder, isWindows ? "runner.exe" : "runner");
  await using build = Bun.spawn({
    cmd: [bunExe(), "build", "--compile", "--aot", "./" + runner, "./fills.ts", "--outfile", executable],
    cwd: folder,
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });
  expect({ stderr: await build.stderr.text(), exitCode: await build.exited }).toEqual({
    stderr: expect.not.stringMatching(/^error\b/m),
    exitCode: 0,
  });

  const started = [
    { way: "plain", cmd: [bunExe(), "run", join(folder, runner)], program: join(folder, "fills.ts") },
    { way: "compiled", cmd: [executable], program: "./fills.ts" },
  ].map(({ way, cmd, program }) => {
    const tasks = join(folder, `tasks-${way}.json`);
    writeFileSync(tasks, JSON.stringify([{ program, cwd: folder }]));
    const env = { ...bunEnv, AOT_TASKS: tasks, AOT_MARK: mark };
    return { way, proc: Bun.spawn({ cmd, cwd: folder, env, stdin: "ignore", stdout: "pipe", stderr: "pipe" }) };
  });
  // Nothing is read meanwhile.
  Bun.sleepSync(3000);
  for (const { way, proc } of started) {
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect({ way, exitCode, stderr, begins: stdout.slice(0, 11), ends: stdout.slice(-mark.length - 5) }).toEqual({
      way,
      exitCode: 0,
      stderr: `\n${mark} 0\n`,
      begins: "it begins\nx",
      ends: `x\n${mark} 0\n`,
    });
  }
}, 120_000);
