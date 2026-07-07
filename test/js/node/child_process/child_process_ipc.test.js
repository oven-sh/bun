import { $ } from "bun";
import { bunEnv, bunExe, tempDir } from "harness";
import { fork } from "node:child_process";
import path from "node:path";

test("subprocess.channel / process.channel expose ref/unref/refCounted/unrefCounted (node compat)", async () => {
  using dir = tempDir("ipc-channel", {
    "child.mjs": `
      const report = {
        ref: typeof process.channel.ref,
        unref: typeof process.channel.unref,
        refCounted: typeof process.channel.refCounted,
        unrefCounted: typeof process.channel.unrefCounted,
      };
      // these must not throw
      process.channel.refCounted();
      process.channel.unrefCounted();
      process.channel.ref();
      process.channel.unref();
      process.send(report);
      process.disconnect();
    `,
  });

  const child = fork(path.join(String(dir), "child.mjs"), { env: bunEnv, execPath: bunExe() });

  const parentChannel = {
    ref: typeof child.channel.ref,
    unref: typeof child.channel.unref,
    refCounted: typeof child.channel.refCounted,
    unrefCounted: typeof child.channel.unrefCounted,
  };
  // these must not throw
  child.channel.refCounted();
  child.channel.unrefCounted();
  child.channel.ref();
  child.channel.unref();

  const { promise, resolve, reject } = Promise.withResolvers();
  let childChannel;
  child.on("message", msg => {
    childChannel = msg;
  });
  child.on("error", reject);
  child.on("exit", code => resolve(code));
  const exitCode = await promise;

  const expected = { ref: "function", unref: "function", refCounted: "function", unrefCounted: "function" };
  expect(parentChannel).toEqual(expected);
  expect(childChannel).toEqual(expected);
  expect(exitCode).toBe(0);
});

test("child process survives a balanced refCounted()/unrefCounted() while a message listener is attached", async () => {
  // A live 'message' listener keeps the IPC channel ref'd; a balanced
  // refCounted()/unrefCounted() pair must not unref the channel out from under
  // it and cause the child to exit before the next message arrives.
  using dir = tempDir("ipc-channel-counted", {
    "child.mjs": `
      process.on("message", msg => {
        if (msg === "ping") {
          process.send("pong");
          process.disconnect();
        }
      });
      // Balanced pair: the listener must still keep the channel alive.
      process.channel.refCounted();
      process.channel.unrefCounted();
      process.send("ready");
    `,
  });

  const child = fork(path.join(String(dir), "child.mjs"), { env: bunEnv, execPath: bunExe() });

  const { promise, resolve, reject } = Promise.withResolvers();
  const messages = [];
  child.on("message", msg => {
    messages.push(msg);
    if (msg === "ready") child.send("ping");
  });
  child.on("error", reject);
  child.on("exit", code => resolve(code));
  const exitCode = await promise;

  expect(messages).toEqual(["ready", "pong"]);
  expect(exitCode).toBe(0);
});

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
