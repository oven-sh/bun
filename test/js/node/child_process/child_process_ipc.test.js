import { $ } from "bun";
import { bunEnv, bunExe } from "harness";
import path from "node:path";

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

// node's ChildProcessSerializer is a v8.DefaultSerializer: it throws an Error, not a DataCloneError DOMException.
// https://github.com/nodejs/node/blob/v26.3.0/lib/internal/child_process/serialization.js#L28
test.concurrent.each(["fork", "cluster"])(
  "send() throws an Error for a message that cannot be cloned (%s, advanced serialization)",
  async mode => {
    await using proc = Bun.spawn({
      cmd: [bunExe(), path.join(import.meta.dir, "fixtures", "ipc-uncloneable-fixture.js"), mode],
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect(stderr).toBe("");
    // node (v26.3.0) has identical output
    expect(stdout).toMatchInlineSnapshot(`
      "parent: a Proxy: threw a plain Error name=Error code=undefined could-not-be-cloned=true
      parent: a nested function: threw a plain Error name=Error code=undefined could-not-be-cloned=true
      parent: a nested symbol: threw a plain Error name=Error code=undefined could-not-be-cloned=true
      child: a Proxy: threw a plain Error name=Error code=undefined could-not-be-cloned=true
      child: a nested function: threw a plain Error name=Error code=undefined could-not-be-cloned=true
      child: a nested symbol: threw a plain Error name=Error code=undefined could-not-be-cloned=true
      child exited with code 0
      "
    `);
    expect(exitCode).toBe(0);
  },
);

test.concurrent("ChildProcess#send() calls send() of a handle that a replaced Bun.spawn answers", async () => {
  // An instrumentation library or a mock can wrap what Bun.spawn answers.
  const script = `
    const { spawn } = require("node:child_process");
    const realSpawn = Bun.spawn;
    Bun.spawn = function (options) {
      const subprocess = realSpawn.call(this, options);
      return new Proxy(subprocess, {
        get(target, key) {
          if (key === "send") {
            return (message, ...rest) => {
              console.log("wrapper sends", JSON.stringify(message));
              return target.send(message, ...rest);
            };
          }
          const value = Reflect.get(target, key, target);
          return typeof value === "function" ? value.bind(target) : value;
        },
      });
    };
    const echo = "process.on('message', message => { process.send(message); process.disconnect(); })";
    const child = spawn(process.execPath, ["-e", echo], { stdio: ["inherit", "inherit", "inherit", "ipc"] });
    child.on("message", message => console.log("child echoed", JSON.stringify(message)));
    child.on("exit", code => console.log("child exited with code", code));
    console.log("send() returned", child.send({ hello: 1 }));
  `;
  await using proc = Bun.spawn({
    cmd: [bunExe(), "-e", script],
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  expect(stderr).toBe("");
  expect(stdout).toMatchInlineSnapshot(`
    "wrapper sends {"hello":1}
    send() returned true
    child echoed {"hello":1}
    child exited with code 0
    "
  `);
  expect(exitCode).toBe(0);
});
