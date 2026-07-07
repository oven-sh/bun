import { $ } from "bun";
import { fork } from "node:child_process";
import path from "node:path";
import { bunEnv, bunExe, tempDir } from "harness";

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
