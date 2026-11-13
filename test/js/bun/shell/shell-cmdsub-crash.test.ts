import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, isWindows, tempDir } from "harness";
import { join } from "node:path";

// Regression test for use-after-poison in builtin output callbacks
// inside command substitution $().
//
// The bug: output_waiting was only incremented for async writes but
// output_done was always incremented, so when stdout is sync (.pipe
// in cmdsub) the counter check `output_done >= output_waiting` fires
// prematurely, calling done() and freeing the builtin while IOWriter
// callbacks are still pending.
//
// Repro requires many pool tasks with errors. `mkdir` and `touch` write
// each result through an OutputTask, the path that had the bug. `ls` keeps
// the same two counters and writes through its own cursor.

describe.skipIf(isWindows)("builtins in command substitution with errors should not crash", () => {
  test("ls with errors in command substitution", async () => {
    // Create a temp directory with many files to produce output,
    // and include non-existent paths to produce errors.
    const files: Record<string, string> = {};
    for (let i = 0; i < 50; i++) {
      files[`file${i}.txt`] = `content${i}`;
    }
    using dir = tempDir("shell-cmdsub", files);

    await using proc = Bun.spawn({
      cmd: [
        bunExe(),
        "-e",
        `
        import { $ } from "bun";
        $.throws(false);
        await $\`echo $(ls $TEST_DIR/* /nonexistent_path_1 /nonexistent_path_2)\`;
        console.log("done");
      `,
      ],
      env: { ...bunEnv, TEST_DIR: String(dir) },
      stderr: "pipe",
      stdout: "pipe",
    });

    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

    expect(stdout).toContain("done");
    expect(exitCode).toBe(0);
  });

  // `ls` lists file operands from one pool task, so the test above no longer runs many tasks. A directory operand
  // is still a task of its own. The listings go to the buffer of `$(...)`, and the two errors go to an IOWriter, so
  // the builtin has to wait for that chunk after the last listing.
  test("ls of many directories with errors in command substitution", async () => {
    const names = Array.from({ length: 50 }, (_, i) => `dir${String(i).padStart(2, "0")}`);
    using dir = tempDir("shell-cmdsub-dirs", Object.fromEntries(names.map(name => [name, { f: "" }])));

    await using proc = Bun.spawn({
      cmd: [
        bunExe(),
        "-e",
        `
        import { $ } from "bun";
        $.throws(false);
        await $\`echo $(ls \${{ raw: process.env.OPERANDS }} nonexistent_path_1 nonexistent_path_2)\`;
        console.log("done");
      `,
      ],
      env: { ...bunEnv, OPERANDS: names.toReversed().join(" ") },
      cwd: String(dir),
      stderr: "pipe",
      stdout: "pipe",
    });

    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

    expect(stderr).toBe(
      "ls: nonexistent_path_1: No such file or directory\nls: nonexistent_path_2: No such file or directory\n",
    );
    expect(stdout).toBe(names.map(name => `${name}: f`).join(" ") + "\ndone\n");
    expect(exitCode).toBe(0);
  });

  // One pool task and one OutputTask for each operand. Each fails, so each writes one line to the IOWriter of stderr
  // and nothing to the buffer of `$(...)`. The lines come in the order the tasks complete.
  test.each(["mkdir", "touch"])("%s with errors in command substitution", async builtin => {
    const operands = Array.from({ length: 50 }, (_, i) => `missing-${String(i).padStart(2, "0")}/x`);
    using dir = tempDir("shell-cmdsub-output-task", {});

    await using proc = Bun.spawn({
      cmd: [
        bunExe(),
        "-e",
        `
        import { $ } from "bun";
        $.throws(false);
        await $\`echo $(\${{ raw: process.env.COMMAND }})\`;
        console.log("done");
      `,
      ],
      env: { ...bunEnv, COMMAND: `${builtin} ${operands.join(" ")}` },
      cwd: String(dir),
      stderr: "pipe",
      stdout: "pipe",
    });

    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

    expect(stderr.split("\n").sort()).toEqual([
      "",
      ...operands.map(operand => `${builtin}: ${join(String(dir), operand)}: No such file or directory`),
    ]);
    expect(stdout).toBe("\ndone\n");
    expect(exitCode).toBe(0);
  });
});
