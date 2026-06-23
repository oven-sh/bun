import type { Subprocess } from "bun";
import { spawn } from "bun";
import { afterEach, expect, it, test } from "bun:test";
import { bunEnv, bunExe, isBroken, isWindows, tempDir, tmpdirSync } from "harness";
import { rmSync } from "node:fs";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";

let watchee: Subprocess;

for (const dir of ["dir", "©️"]) {
  it.todoIf(isBroken && isWindows)(
    `should watch files${dir === "dir" ? "" : " (non-ascii path)"}`,
    async () => {
      const cwd = join(tmpdirSync(), dir);
      const path = join(cwd, "watchee.js");

      const updateFile = async (i: number) => {
        await Bun.write(path, `console.log(${i}, __dirname);`);
      };

      let i = 0;
      await updateFile(i);
      await Bun.sleep(1000);
      watchee = spawn({
        cwd,
        cmd: [bunExe(), "--watch", "watchee.js"],
        env: bunEnv,
        stdout: "pipe",
        stderr: "inherit",
        stdin: "ignore",
      });

      for await (const line of watchee.stdout) {
        if (i == 10) break;
        var str = new TextDecoder().decode(line);
        expect(str).toContain(`${i} ${cwd}`);
        i++;
        await updateFile(i);
      }
      rmSync(path);
    },
    10000,
  );
}

afterEach(() => {
  watchee?.kill();
});

// process.exit() used to tear down the whole process in --watch mode, killing
// the watcher itself. It should instead end the current run (like a thrown
// error does) and keep the watcher waiting for the next change.
// https://github.com/oven-sh/bun/issues/32648
const exitScenarios = {
  // process.exit() during top-level evaluation.
  direct: (n: number) => `console.log("MARK:${n}");\nprocess.exit(1);\nconsole.log("AFTER_EXIT_SHOULD_NOT_PRINT");\n`,
  // Callbacks queued before process.exit() must not resume while the watcher
  // waits for the next change.
  "pending callbacks": (n: number) =>
    `console.log("MARK:${n}");\nsetImmediate(() => console.log("AFTER_EXIT_SHOULD_NOT_PRINT"));\nsetTimeout(() => console.log("AFTER_EXIT_SHOULD_NOT_PRINT"), 0);\nprocess.exit(1);\n`,
  // process.exit() from a beforeExit handler: the run ends normally, then the
  // handler calls process.exit() while the watcher loop is dispatching
  // beforeExit.
  "beforeExit handler": (n: number) =>
    `console.log("MARK:${n}");\nprocess.on("beforeExit", () => { process.exit(1); console.log("AFTER_EXIT_SHOULD_NOT_PRINT"); });\n`,
} as const;

for (const mode of ["--watch"] as const) {
  for (const [scenario, fixture] of Object.entries(exitScenarios)) {
    test(`${mode}: process.exit() (${scenario}) keeps the watcher alive`, async () => {
      using dir = tempDir("watch-process-exit", { "index.ts": fixture(0) });
      const path = join(String(dir), "index.ts");

      await using proc = spawn({
        cmd: [bunExe(), mode, "--no-clear-screen", "index.ts"],
        cwd: String(dir),
        env: bunEnv,
        stdout: "pipe",
        stderr: "pipe",
        stdin: "ignore",
      });

      // Drain stderr so a full pipe never blocks the child.
      const stderrText = proc.stderr.text();

      const decoder = new TextDecoder();
      const reader = proc.stdout.getReader();
      let out = "";
      const waitForMark = async (n: number) => {
        const marker = `MARK:${n}`;
        while (!out.includes(marker)) {
          const { done, value } = await reader.read();
          if (done) {
            throw new Error(
              `watcher exited before reload ${n} (process.exit() killed it). stdout so far: ${JSON.stringify(out)}`,
            );
          }
          out += decoder.decode(value, { stream: true });
        }
      };

      // First run executes and calls process.exit().
      await waitForMark(0);

      // Each edit must reload, proving the watcher survived the previous
      // process.exit().
      for (let n = 1; n <= 2; n++) {
        await writeFile(path, fixture(n));
        await waitForMark(n);
      }

      // process.exit() stops execution: the statement after it never runs.
      expect(out).not.toContain("AFTER_EXIT_SHOULD_NOT_PRINT");
      // The watcher is still running (we reloaded twice after process.exit()).
      expect(proc.exitCode).toBeNull();

      await reader.cancel();
      proc.kill();
      await stderrText;
    });
  }
}

// The keepalive is scoped to --watch (it re-execs on change). --hot
// re-evaluates in place, so process.exit() there still exits the process.
test("--hot: process.exit() exits the process (no keepalive)", async () => {
  using dir = tempDir("hot-process-exit", {
    "index.ts": `console.log("HOT_RAN");\nprocess.exit(3);\nconsole.log("AFTER_EXIT_SHOULD_NOT_PRINT");\n`,
  });

  await using proc = spawn({
    cmd: [bunExe(), "--hot", "--no-clear-screen", "index.ts"],
    cwd: String(dir),
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
    stdin: "ignore",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  expect(stdout).toContain("HOT_RAN");
  expect(stdout).not.toContain("AFTER_EXIT_SHOULD_NOT_PRINT");
  // Exited on its own with the given code instead of staying alive as a watcher.
  if (exitCode !== 3) console.error(stderr);
  expect(exitCode).toBe(3);
});
