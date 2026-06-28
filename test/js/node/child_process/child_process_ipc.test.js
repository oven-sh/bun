import { $ } from "bun";
import { bunEnv, bunExe, tempDir } from "harness";

test("child_process ipc", async () => {
  const output = await $`${bunExe()} ${import.meta.dir}/fixtures/ipc_fixture.js`.text();
  // node (v23.4.0) has identical output
  expect(output).toMatchInlineSnapshot(`
    "Parent received: {"status":"Child process started"}
    Child process exited with code 0
    send returned false
    uncaughtException ERR_IPC_CHANNEL_CLOSED
    cb ERR_IPC_CHANNEL_CLOSED
    "
  `);
});

// https://github.com/oven-sh/bun/issues/30569
// Node: `send()` returns false once `channel.writeQueueSize >= 65536 * 2`.
// This boolean is the only backpressure signal IPC exposes, so a producer
// that follows the documented contract never throttles if it stays true.
describe("send() returns false when the IPC write queue backs up", () => {
  // The child sends "ready" then busy-loops so it never drains the IPC pipe.
  // The parent floods ~64 KiB messages until send() returns false (or gives
  // up after 500 sends, ~32 MiB). Printed as "true=N false=M" so the
  // assertion shows the actual split on failure.
  //
  // The child only enters the busy-loop from the send() callback (which fires
  // once "ready" has actually been written), not immediately after the call:
  // the first send() lazily opens the IPC socket and, in advanced mode on
  // Windows, queues a version packet behind an async uv_write, so "ready"
  // would otherwise sit unsent forever once the event loop stops running.
  const fixture = `
    const cp = require("child_process");
    if (process.argv[2] === "--child") {
      process.send("ready", () => {
        const end = Date.now() + 10000;
        while (Date.now() < end) {}
        process.exit(0);
      });
      return;
    }
    const child = cp.fork(__filename, ["--child"], { serialization: process.argv[2] });
    child.on("message", () => {
      const payload = { s: Buffer.alloc(65536, "z").toString() };
      let t = 0, f = 0;
      for (let i = 0; i < 500; i++) {
        if (child.send(payload) === false) { f++; break; }
        t++;
      }
      console.log("true=" + t + " false=" + f);
      child.kill("SIGKILL");
      child.on("close", () => process.exit(0));
    });
    child.on("error", err => { console.error(String(err)); process.exit(1); });
  `;

  test.each(["json", "advanced"])("child_process fork (%s)", async serialization => {
    using dir = tempDir("ipc-backpressure", { "index.js": fixture });
    await using proc = Bun.spawn({
      cmd: [bunExe(), "index.js", serialization],
      env: bunEnv,
      cwd: String(dir),
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    // Exactly one send() must have returned false (the loop breaks on it).
    // The count of true returns before that depends on the kernel socket
    // buffer size, so only the false count is fixed. stderr is not asserted
    // (debug/ASAN builds can emit benign noise) but is included so a fixture
    // failure shows up in the same diff as the counts and exit code.
    expect({ stdout: stdout.trim(), stderr, exitCode }).toEqual({
      stdout: expect.stringMatching(/^true=\d+ false=1$/),
      stderr,
      exitCode: 0,
    });
  });

  // Child-side process.send(): parent blocks its event loop so nothing
  // drains the parent end of the IPC pipe; child floods upward and writes
  // its result to a file (stdout would not be drained either).
  test("process.send from child", async () => {
    using dir = tempDir("ipc-backpressure-child", {
      "index.js": `
        const cp = require("child_process");
        const fs = require("fs");
        const path = require("path");
        const resultPath = path.join(__dirname, "result.txt");
        const child = cp.fork(path.join(__dirname, "child.js"), [resultPath]);
        // Enter the busy-spin only once "go" has actually been written (the
        // send callback fires on write completion), then never yield again.
        // The event loop does not run during sync fs calls, so the IPC
        // socket is never read here.
        child.send("go", () => {
          const deadline = Date.now() + 15000;
          while (!fs.existsSync(resultPath) && Date.now() < deadline) {}
          process.stdout.write(fs.existsSync(resultPath) ? fs.readFileSync(resultPath, "utf8") : "");
          child.kill("SIGKILL");
          child.on("close", () => process.exit(0));
        });
      `,
      "child.js": `
        const fs = require("fs");
        const resultPath = process.argv[2];
        process.on("message", () => {
          const payload = { s: Buffer.alloc(65536, "z").toString() };
          let t = 0, f = 0;
          for (let i = 0; i < 500; i++) {
            if (process.send(payload) === false) { f++; break; }
            t++;
          }
          // writeFileSync is open(O_CREAT) + write + close, so the parent's
          // existsSync spin could observe the name before the bytes land.
          // Publish atomically with a rename instead.
          fs.writeFileSync(resultPath + ".tmp", "true=" + t + " false=" + f + "\\n");
          fs.renameSync(resultPath + ".tmp", resultPath);
          process.exit(0);
        });
      `,
    });
    await using proc = Bun.spawn({
      cmd: [bunExe(), "index.js"],
      env: bunEnv,
      cwd: String(dir),
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    // See above: stderr is surfaced in the diff but not asserted empty.
    expect({ stdout: stdout.trim(), stderr, exitCode }).toEqual({
      stdout: expect.stringMatching(/^true=\d+ false=1$/),
      stderr,
      exitCode: 0,
    });
  });
});
