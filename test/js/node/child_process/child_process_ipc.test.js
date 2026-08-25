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

// A message whose serialization throws (a getter here) rejects that send with the thrown error, the channel
// stays usable, and nothing else is delivered in its place — for process.send() and cluster's worker.send().
test.each(["json", "advanced"])("send() with a message that throws while serializing (%s)", async serialization => {
  const src = `
    const cluster = require("node:cluster");
    if (cluster.isPrimary) {
      cluster.setupPrimary({ serialization: ${JSON.stringify(serialization)} });
      const worker = cluster.fork();
      const err = new Error("primary getter");
      worker.on("message", m => {
        if (m === "ready") {
          let caught;
          try { worker.send({ get x() { throw err; } }); } catch (e) { caught = e; }
          console.log("primary caught own error:", caught === err);
          worker.send("after");
        } else {
          console.log("primary got:", JSON.stringify(m));
          if (m.done) worker.kill();
        }
      });
      worker.on("exit", () => console.log("worker exited"));
    } else {
      const err = new Error("worker getter");
      let caught;
      try { process.send({ get x() { throw err; } }); } catch (e) { caught = e; }
      process.send({ workerCaughtOwnError: caught === err });
      process.on("message", m => { if (m === "after") process.send({ done: true }); });
      process.send("ready");
    }
  `;
  // cluster.fork() re-executes argv[1], so this needs a real file.
  using dir = tempDir("ipc-throwing-serialize", { "main.js": src });
  await using proc = Bun.spawn({
    cmd: [bunExe(), "main.js"],
    env: bunEnv,
    cwd: String(dir),
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  expect({ stdout: stdout.trim().split("\n"), stderr, exitCode }).toEqual({
    stdout: [
      `primary got: {"workerCaughtOwnError":true}`,
      "primary caught own error: true",
      `primary got: {"done":true}`,
      "worker exited",
    ],
    stderr: "",
    exitCode: 0,
  });
});
