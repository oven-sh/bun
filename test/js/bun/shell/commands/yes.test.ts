import { $ } from "bun";
import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, isPosix } from "harness";

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

  // `bun exec` has its own event loop. A captured `yes` never does I/O and never ends, so the loop
  // has to poll between two of its bursts for the exit of the other member to be seen.
  test.skipIf(!isPosix)("captured under `bun exec`, lets the event loop poll", async () => {
    await using proc = Bun.spawn({
      cmd: [bunExe(), "exec", `echo $(sh -c 'echo $$ >&2' | yes)`],
      env: bunEnv,
      stdout: "ignore",
      stderr: "pipe",
    });
    let stderr = "";
    for await (const chunk of proc.stderr) {
      stderr += Buffer.from(chunk).toString();
      if (stderr.includes("\n")) break;
    }
    const pid = Number(stderr);
    expect(pid).toBeGreaterThan(0);
    // A child that has exited stays a zombie, which signal 0 still reaches, until the shell reaps it.
    const isReaped = () => {
      try {
        process.kill(pid, 0);
        return false;
      } catch (error) {
        expect(error).toMatchObject({ code: "ESRCH" });
        return true;
      }
    };
    while (!isReaped()) await new Promise(resolve => setImmediate(resolve));
    expect(proc.exitCode).toBeNull();
  });
});
