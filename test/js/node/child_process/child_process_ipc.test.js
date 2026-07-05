import { $ } from "bun";
import { expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { fork } from "node:child_process";
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

// A message `JSON.stringify` maps to `undefined` must be rejected by `send()` itself. Before,
// it was serialized to a zero-length frame, which the peer rejects as malformed and responds to
// by closing the IPC channel: every queued and subsequent message was silently lost.
const ECHO_CHILD = `
process.on("message", message => {
  if (message === "probe-unserializable") {
    try {
      process.send(() => {});
      process.send({ threw: null });
    } catch (err) {
      process.send({ threw: { code: err.code, name: err.name, message: err.message } });
    }
    return;
  }
  process.send({ echo: message });
});
`;

function forkEchoChild() {
  const dir = tempDir("child-process-ipc-serialization", { "echo-child.js": ECHO_CHILD });
  const child = fork(path.join(String(dir), "echo-child.js"), { env: bunEnv });
  return { child, [Symbol.dispose]: () => (child.kill(), dir[Symbol.dispose]()) };
}

/** Resolves with the next `message`, rejects if the IPC channel dies first. */
function nextMessage(child) {
  const { promise, resolve, reject } = Promise.withResolvers();
  const onMessage = message => (cleanup(), resolve(message));
  const onDisconnect = () => (cleanup(), reject(new Error("IPC channel closed before a message arrived")));
  const onError = err => (cleanup(), reject(err));
  const onExit = code => (cleanup(), reject(new Error(`child exited with code ${code}`)));
  const cleanup = () => {
    child.off("message", onMessage);
    child.off("disconnect", onDisconnect);
    child.off("error", onError);
    child.off("exit", onExit);
  };
  child.on("message", onMessage);
  child.on("disconnect", onDisconnect);
  child.on("error", onError);
  child.on("exit", onExit);
  return promise;
}

/** Round-trips a message through the child, proving the channel is still usable. */
function echo(child, message) {
  const received = nextMessage(child);
  expect(child.send(message)).toBe(true);
  return received;
}

test.concurrent("subprocess.send() of a function throws ERR_INVALID_ARG_TYPE", async () => {
  using forked = forkEchoChild();
  const { child } = forked;

  let thrown;
  try {
    child.send(() => {});
  } catch (err) {
    thrown = err;
  }
  expect(thrown).toBeInstanceOf(TypeError);
  expect({ code: thrown?.code, message: thrown?.message }).toEqual({
    code: "ERR_INVALID_ARG_TYPE",
    message: 'The "message" argument must be one of type string, object, number, or boolean. Received function ',
  });

  // The channel must be untouched by the rejected message.
  expect(child.connected).toBe(true);
  expect(await echo(child, { ping: 1 })).toEqual({ echo: { ping: 1 } });
});

test.concurrent("process.send() of a function throws ERR_INVALID_ARG_TYPE in the child", async () => {
  using forked = forkEchoChild();
  const { child } = forked;

  expect(await echo(child, "probe-unserializable")).toEqual({
    threw: {
      code: "ERR_INVALID_ARG_TYPE",
      name: "TypeError",
      message: 'The "message" argument must be one of type string, object, number, or boolean. Received function ',
    },
  });

  expect(await echo(child, { ping: 2 })).toEqual({ echo: { ping: 2 } });
});

test.concurrent("subprocess.send() of a value whose toJSON() returns undefined keeps the channel open", async () => {
  using forked = forkEchoChild();
  const { child } = forked;

  expect(() => child.send({ toJSON: () => undefined })).toThrow(
    expect.objectContaining({ code: "ERR_INVALID_ARG_TYPE" }),
  );
  expect(await echo(child, { ping: 3 })).toEqual({ echo: { ping: 3 } });
});

test.concurrent("subprocess.send() of a cyclic message rethrows and never reports success", async () => {
  using forked = forkEchoChild();
  const { child } = forked;

  const cyclic = {};
  cyclic.self = cyclic;
  const callbackArgs = [];
  expect(() => child.send(cyclic, err => callbackArgs.push(err))).toThrow(TypeError);

  // A full round-trip is a bounded window: a `process.nextTick` callback queued by the failed
  // send would have run well before the echo comes back.
  expect(await echo(child, { ping: 4 })).toEqual({ echo: { ping: 4 } });
  expect(callbackArgs).toEqual([]);
});
