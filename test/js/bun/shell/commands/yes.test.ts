import { $ } from "bun";
import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe } from "harness";

$.throws(false);

describe("yes", async () => {
  test("can pipe to a buffer", async () => {
    const buffer = Buffer.alloc(10);
    await $`yes > ${buffer}`;
    expect(buffer.toString()).toEqual("y\ny\ny\ny\ny\n");
  });

  test("can be overwritten by the first argument", async () => {
    const buffer = Buffer.alloc(18);
    await $`yes xy > ${buffer}`;
    expect(buffer.toString()).toEqual("xy\nxy\nxy\nxy\nxy\nxy\n");
  });

  test("ignores other arguments", async () => {
    const buffer = Buffer.alloc(17);
    await $`yes ab cd ef > ${buffer}`;
    expect(buffer.toString()).toEqual("ab cd ef\nab cd ef");
  });

  // When stdout is an in-memory sink, `yes` writes 4 × 8 KiB then re-enqueues
  // itself via ShellYesTask to yield the event loop. A buffer larger than
  // 32 KiB forces that re-enqueue; the dispatch table needs an arm for the
  // tag or the process aborts with "Unexpected Task tag". Isolated in a
  // subprocess so the abort is observable as an assertion failure.
  test("fills a buffer larger than one no-IO burst", async () => {
    await using proc = Bun.spawn({
      cmd: [
        bunExe(),
        "-e",
        `import { $ } from "bun";
         $.throws(false);
         const buf = Buffer.alloc(40000);
         await $\`yes > \${buf}\`.quiet();
         if (!buf.equals(Buffer.alloc(40000, "y\\n"))) throw new Error("buffer mismatch");
         console.log("ok");`,
      ],
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([
      proc.stdout.text(),
      proc.stderr.text(),
      proc.exited,
    ]);
    expect(stderr).toBe("");
    expect(stdout).toBe("ok\n");
    expect(exitCode).toBe(0);
  });
});
