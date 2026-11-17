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

  test.skipIf(isWindows)("lets the event loop turn while it fills a file", async () => {
    using dir = tempDir("yes-file", {});
    const script = `
      const order = [];
      const done = Bun.$\`yes ab > out\`.nothrow().then(r => order.push("exit " + r.exitCode));
      setImmediate(() => order.push("immediate"));
      await done;
      const text = await Bun.file("out").text();
      console.log(JSON.stringify({ order, full: text.length >= 1 << 20, intact: "ab\\n".repeat(1 << 20).startsWith(text) }));
    `;
    await using proc = Bun.spawn({
      // The file size limit ends the command with EFBIG.
      cmd: ["sh", "-c", `trap '' XFSZ; ulimit -f 2048; exec "$0" -e "$1"`, bunExe(), script],
      env: bunEnv,
      cwd: String(dir),
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect(stderr).toBe("");
    expect(JSON.parse(stdout)).toEqual({ order: ["immediate", "exit 1"], full: true, intact: true });
    expect(exitCode).toBe(0);
  });

  test.skipIf(isWindows)("a Worker that runs `yes > /dev/null` can be terminated", async () => {
    using dir = tempDir("yes-worker", {
      "main.js": `
        import { Worker, isMainThread, parentPort } from "node:worker_threads";
        if (isMainThread) {
          const worker = new Worker(import.meta.filename);
          worker.once("message", async () => console.log(await worker.terminate()));
        } else {
          const running = Bun.$\`yes > /dev/null\`.then(() => {});
          parentPort.postMessage("started");
          await running;
        }
      `,
    });
    await using proc = Bun.spawn({
      cmd: [bunExe(), "main.js"],
      env: bunEnv,
      cwd: String(dir),
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect(stderr).toBe("");
    expect(stdout).toBe("1\n");
    expect(exitCode).toBe(0);
  });
});
