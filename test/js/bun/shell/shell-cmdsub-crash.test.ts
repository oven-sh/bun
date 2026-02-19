import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, isWindows, tempDir } from "harness";

// Regression test for use-after-poison in builtin OutputTask callbacks
// inside command substitution $().
//
// The bug: output_waiting was only incremented for async writes but
// output_done was always incremented, so when stdout is sync (.pipe
// in cmdsub) the counter check `output_done >= output_waiting` fires
// prematurely, calling done() and freeing the builtin while IOWriter
// callbacks are still pending.
//
// Repro requires many ls tasks with errors — listing many entries
// alongside non-existent paths reliably triggers the ASAN
// use-after-poison.

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
});
