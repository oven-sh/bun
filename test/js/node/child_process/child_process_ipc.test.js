import { $ } from "bun";
import { bunEnv, bunExe } from "harness";

test.concurrent("child_process ipc", async () => {
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

test.concurrent("which operations on subprocess.channel hold the event loop", async () => {
  const output = await $`${bunExe()} ${import.meta.dir}/fixtures/ipc-channel-ref-fixture.mjs rows parent`
    .env(bunEnv)
    .text();
  // node (v26.7.0) has identical output, without the Bun.spawn row and with "held" for send(small):
  // only a write that does not finish at once ends the hold there.
  expect(output).toMatchInlineSnapshot(`
    "parent: child.unref: held
    parent: child.unref unref: not held
    parent: child.unref unref ref: held
    parent: child.unref refCounted unrefCounted: not held
    parent: child.unref disconnect: not held
    parent: child.unref disconnect ref: not held
    parent: child.unref send(small): not held
    parent: child.unref send(big): not held
    parent: child.unref ref send(big): held
    parent: child.unref unrefCounted send(big)x2: not held
    parent: child.unref send(handle): not held
    parent: advanced child.unref: held
    Bun.spawn: child.unref: not held
    "
  `);
});

test.concurrent("which operations on process.channel hold the event loop", async () => {
  const output = await $`${bunExe()} ${import.meta.dir}/fixtures/ipc-channel-ref-fixture.mjs rows child`
    .env(bunEnv)
    .text();
  // node (v26.7.0) has identical output
  expect(output).toMatchInlineSnapshot(`
    "child: none: not held
    child: on(message,a): held
    child: on(disconnect,a): held
    child: on(message,a) off(message,a): not held
    child: on(message,a) on(message,b) off(message,a): held
    child: on(message,a) on(message,b) removeAll(message): not held
    child: on(message,a) unrefCounted: not held
    child: on(message,a) on(disconnect,a) unrefCounted: held
    child: on(message,a) on(message,b) unrefCounted removeAll(message) on(message,a): not held
    child: refCounted: held
    child: refCounted unrefCounted: not held
    child: refCounted refCounted unrefCounted: held
    child: unrefCounted refCounted: not held
    child: unrefCounted on(message,a): not held
    child: ref: held
    child: ref unrefCounted: held
    child: ref on(message,a) off(message,a): held
    child: on(message,a) unref: not held
    child: on(message,a) unref refCounted: not held
    child: unref on(message,a): not held
    child: send(big): not held
    child: on(message,a) send(big): held
    child: on(message,a) disconnect: not held
    child: disconnect ref: not held
    "
  `);
});

test.concurrent("a child held only by process.channel.ref() leaves when the parent disconnects", async () => {
  await using child = Bun.spawn({
    cmd: [bunExe(), "-e", `process.channel.ref(); console.log("ready");`],
    env: bunEnv,
    stdout: "pipe",
    ipc() {},
  });
  await child.stdout.getReader().read();
  child.disconnect();
  expect(await child.exited).toBe(0);
});

test.concurrent("a channel that could not be opened does not hold the event loop", async () => {
  await using child = Bun.spawn({
    cmd: [bunExe(), "-e", `process.on("message", () => {});`],
    env: { ...bunEnv, NODE_CHANNEL_FD: "99", NODE_CHANNEL_SERIALIZATION_MODE: "json" },
    stderr: "pipe",
  });
  expect(await child.stderr.text()).toContain("Unable to start IPC");
  expect(await child.exited).toBe(0);
});

test.concurrent("a message that arrives before there is a 'message' listener is kept for it", async () => {
  const output = await $`${bunExe()} ${import.meta.dir}/fixtures/ipc-pending-messages-fixture.mjs`.env(bunEnv).text();
  // node (v26.7.0) has identical output
  expect(output).toMatchInlineSnapshot(`
    "child, a late listener: ["first","second","end"]
    child, a handle: [["first","Server"],"second","end"]
    child, a listener that throws: ["first","first","end"]
    child, a listener that throws, added before another: ["end"]
    child, a listener that throws, then a listener for another event: ["first","first","first","end"]
    child, once: ["first","end"]
    child, added and removed in one tick: ["first","second","end"]
    child, disconnect() in the tick that adds it: []
    child, removeAllListeners('newListener'): ["end"]
    child, on() down to the stack limit: ["RangeError","first","second","end"]
    child, nobody listens and listenerCount() returns 1 as they arrive: ["end"]
    child, nobody listens and listenerCount() returns 1 in the tick: ["end"]
    child, the listenerCount() of node:events: ["first","second","end"]
    child, nobody listens and listenerCount() throws: ["RangeError","RangeError","end"]
    child, nobody listens and listenerCount is 5: ["TypeError","TypeError","end"]
    parent, a late listener: ["first","second","end"]
    parent, a handle: [["first","Server"],"second","end"]
    parent, a listener that throws: ["first","first","end"]
    parent, a listener that throws, added before another: ["end"]
    parent, a listener that throws, then a listener for another event: ["first","first","first","end"]
    parent, once: ["first","end"]
    parent, added and removed in one tick: ["first","second","end"]
    parent, disconnect() in the tick that adds it: []
    parent, removeAllListeners('newListener'): ["end"]
    parent, on() down to the stack limit: ["RangeError","first","second","end"]
    parent, nobody listens and listenerCount() returns 1 as they arrive: ["end"]
    parent, nobody listens and listenerCount() returns 1 in the tick: ["end"]
    parent, the listenerCount() of node:events: ["first","second","end"]
    parent, nobody listens and listenerCount() throws: ["RangeError","RangeError","end"]
    parent, nobody listens and listenerCount is 5: ["TypeError","TypeError","end"]
    "
  `);
});
