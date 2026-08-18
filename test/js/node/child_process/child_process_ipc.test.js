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

test("'disconnect' is emitted before 'exit' when the channel's EOF and the exit are seen in the same poll", async () => {
  // The parent stays off its event loop from the moment it asks the child to close the channel
  // until the child is dead, so it picks up the channel's EOF and the exit together. Node emits
  // 'disconnect' while handling the EOF, before it gets to the exit; the EOF used to be handed to a
  // later event-loop task here, so 'exit' (emitted straight from the exit notification) came first.
  // The parent blocks from the child's stdout rather than from a 'message' handler: on Windows the
  // channel's read is only re-armed once a 'message' handler returns, so an EOF arriving while one
  // blocks is not observed until after the exit.
  using dir = tempDir("ipc-disconnect-before-exit", {
    "parent.js": `
      const { fork } = require("node:child_process");
      const { existsSync, readdirSync, readFileSync } = require("node:fs");
      const path = require("node:path");

      const deadline = Date.now() + 30_000;
      function blockUntil(what, condition) {
        while (!condition()) {
          if (Date.now() > deadline) throw new Error("timed out waiting for " + what);
          Bun.sleepSync(1);
        }
      }
      // On Linux the child is dead once /proc shows it as a zombie with no other threads left (the
      // last thread to go is the one that closes its descriptors and signals the exit; a debug
      // build takes ~15ms to get there). Elsewhere a SIGKILL'd child is gone within a few ms.
      function blockUntilDead(pid) {
        if (process.platform !== "linux") return Bun.sleepSync(100);
        blockUntil("the child to die", () => {
          const stat = readFileSync("/proc/" + pid + "/stat", "latin1");
          return stat[stat.lastIndexOf(")") + 2] === "Z" && readdirSync("/proc/" + pid + "/task").length === 1;
        });
      }

      const closed = path.join(__dirname, "channel-closed");
      const child = fork(path.join(__dirname, "child.js"), [closed], {
        stdio: ["ignore", "pipe", "inherit", "ipc"],
      });
      const events = [];
      child.stdout.once("data", () => {
        child.send("close-your-end");
        blockUntil("the child to close the channel", () => existsSync(closed));
        child.kill("SIGKILL");
        blockUntilDead(child.pid);
      });
      child.on("disconnect", () => events.push("disconnect"));
      child.on("exit", () => events.push("exit"));
      child.on("close", () => console.log(JSON.stringify(events)));
    `,
    "child.js": `
      const { writeFileSync } = require("node:fs");
      process.on("message", () => {
        process.disconnect();
        writeFileSync(process.argv[2], "");
      });
      setInterval(() => {}, 1000); // stay alive until the parent kills us
      console.log("ready");
    `,
  });

  await using proc = Bun.spawn({
    cmd: [bunExe(), "parent.js"],
    cwd: String(dir),
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  expect({ events: stdout.trim(), stderr, exitCode }).toEqual({
    events: JSON.stringify(["disconnect", "exit"]),
    stderr: "",
    exitCode: 0,
  });
});
