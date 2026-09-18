import { $ } from "bun";
import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { fork } from "node:child_process";
import { once } from "node:events";
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

// node v26.3.0 throws the same error for each of these, in both serialization modes, and the channel keeps working.
describe.each(["json", "advanced"])("send() of a function (%s)", serialization => {
  const received = name =>
    `The "message" argument must be one of type string, object, number, or boolean. Received function ${name}`;

  function forkEcho() {
    const dir = tempDir("ipc-send-function", {
      "child.js": `
        process.on("message", message => {
          if (message !== "send a function") return process.send({ echo: message });
          try {
            process.send(function fromChild() {}, () => process.send({ callback: "called" }));
            process.send({ threw: "nothing" });
          } catch (err) {
            process.send({ threw: { name: err.name, code: err.code, message: err.message } });
          }
        });
      `,
    });
    const child = fork(path.join(String(dir), "child.js"), { env: bunEnv, serialization });
    return { child, [Symbol.dispose]: () => (child.kill("SIGKILL"), dir[Symbol.dispose]()) };
  }

  // Resolves with the next message. Rejects when the channel or the child goes away first.
  async function nextMessage(child) {
    const gone = new AbortController();
    const fail = event =>
      once(child, event, { signal: gone.signal }).then(args => {
        throw new Error(`'${event}' before the next message: ${args}`);
      });
    try {
      const [message] = await Promise.race([
        once(child, "message", { signal: gone.signal }),
        fail("disconnect"),
        fail("exit"),
      ]);
      return message;
    } finally {
      gone.abort();
    }
  }

  test.concurrent("subprocess.send() throws ERR_INVALID_ARG_TYPE and the channel keeps working", async () => {
    using forked = forkEcho();
    const { child } = forked;
    const callbacks = [];

    const callables = { named: function named() {}, A: class A {} };
    for (const [name, callable] of Object.entries(callables)) {
      let thrown;
      try {
        child.send(callable, err => callbacks.push(err));
      } catch (err) {
        thrown = err;
      }
      expect(thrown).toBeInstanceOf(TypeError);
      expect({ code: thrown.code, message: thrown.message }).toEqual({
        code: "ERR_INVALID_ARG_TYPE",
        message: received(name),
      });
    }
    // typeof is "function" for a callable Proxy too. Only the code is pinned: Bun does not name the Proxy's target in the message yet.
    expect(() => child.send(new Proxy(function target() {}, {}), err => callbacks.push(err))).toThrow(
      expect.objectContaining({ code: "ERR_INVALID_ARG_TYPE" }),
    );

    expect(child.connected).toBe(true);
    const echoed = nextMessage(child);
    expect(child.send({ ping: 1 })).toBe(true);
    expect(await echoed).toEqual({ echo: { ping: 1 } });
    expect(callbacks).toEqual([]);
  });

  test.concurrent("process.send() throws ERR_INVALID_ARG_TYPE in the child and the channel keeps working", async () => {
    using forked = forkEcho();
    const { child } = forked;

    let reply = nextMessage(child);
    child.send("send a function");
    expect(await reply).toEqual({
      threw: { name: "TypeError", code: "ERR_INVALID_ARG_TYPE", message: received("fromChild") },
    });

    // A callback from the rejected send would arrive before this echo.
    reply = nextMessage(child);
    child.send({ ping: 2 });
    expect(await reply).toEqual({ echo: { ping: 2 } });
  });
});
