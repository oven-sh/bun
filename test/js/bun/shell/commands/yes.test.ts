import { $ } from "bun";
import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, isWindows, tempDir } from "harness";

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

  test("fills a buffer larger than one no-IO burst", async () => {
    // One no-IO burst writes ~4*BUFSIZ before `yes` re-schedules itself on
    // the event loop; a buffer larger than that forces the re-schedule path
    // at least once before the target fills and returns ENOSPC. Run in a
    // subprocess so a regression surfaces as a test failure rather than
    // aborting the runner.
    await using proc = Bun.spawn({
      cmd: [
        bunExe(),
        "-e",
        `import { $ } from "bun";
         const buffer = Buffer.alloc(128 * 1024);
         const { exitCode, stderr } = await $\`yes hi > \${buffer}\`.nothrow().quiet();
         console.log(JSON.stringify({
           exitCode,
           stderr: stderr.toString(),
           head: buffer.subarray(0, 12).toString(),
           filled: buffer.indexOf(0) === -1,
         }));`,
      ],
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect(stderr).toBe("");
    expect(JSON.parse(stdout)).toEqual({
      exitCode: 1,
      stderr: "yes: ENOSPC\n",
      head: "hi\nhi\nhi\nhi\n",
      filled: true,
    });
    expect(exitCode).toBe(0);
  });

  // A write to /dev/null (or to a regular file) completes on the spot, so only
  // `yes` itself can hand the thread back to the event loop between chunks.
  // Not concurrent: the runner kills the child of a sequential test that times
  // out, and a child that never yields would otherwise spin on after the run.
  test.each([
    ["a redirect to /dev/null", "$`yes > /dev/null`.quiet()"],
    ["an inherited stdout that is /dev/null", "$`yes`"],
  ])("does not block the event loop with %s", async (_, shell) => {
    await using proc = Bun.spawn({
      cmd: [
        bunExe(),
        "-e",
        `import { $ } from "bun";
         ${shell}.nothrow().run();
         console.error("run() returned");
         let ticks = 0;
         setInterval(() => {
           if (++ticks === 3) {
             console.error("timers fired");
             process.exit(0);
           }
         }, 1);`,
      ],
      env: bunEnv,
      stdout: "ignore",
      stderr: "pipe",
    });
    const [stderr, exitCode] = await Promise.all([proc.stderr.text(), proc.exited]);
    expect(stderr).toBe("run() returned\ntimers fired\n");
    expect(exitCode).toBe(0);
  });

  // `ulimit -f` caps out.txt. A `yes` that never yields fills the file inside
  // run() and stops on EFBIG, so a regression fails here with a small file
  // instead of writing gigabytes until the test times out.
  test.skipIf(isWindows)("does not block the event loop with a redirect to a regular file", async () => {
    // 512 or 1024 bytes per block, depending on the shell.
    const blocks = 32768;
    using dir = tempDir("yes-regular-file", {});
    await using proc = Bun.spawn({
      cmd: [
        "/bin/sh",
        "-c",
        `ulimit -f ${blocks} && exec "$@"`,
        "sh",
        bunExe(),
        "-e",
        `import { $ } from "bun";
         import { statSync } from "node:fs";
         $\`yes > out.txt\`.quiet().nothrow().run();
         const full = statSync("out.txt").size >= ${blocks} * 512;
         console.error("run() returned, out.txt is " + (full ? "full" : "not full"));
         let ticks = 0;
         setInterval(() => {
           if (++ticks === 3) {
             console.error("timers fired");
             process.exit(0);
           }
         }, 1);`,
      ],
      cwd: String(dir),
      env: bunEnv,
      stdout: "ignore",
      stderr: "pipe",
    });
    const [stderr, exitCode] = await Promise.all([proc.stderr.text(), proc.exited]);
    expect(stderr).toBe("run() returned, out.txt is not full\ntimers fired\n");
    expect(exitCode).toBe(0);
  });
});
