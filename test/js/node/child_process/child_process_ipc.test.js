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

test.concurrent("kept messages where a process ends, or is at the stack limit", async () => {
  const output = await $`${bunExe()} ${import.meta.dir}/fixtures/ipc-pending-messages-ending-fixture.cjs`
    .env(bunEnv)
    .text();
  // node (v26.7.0) has identical output
  expect(output).toMatchInlineSnapshot(`
    "child, a listener and then an exception that nobody handles: ["exit listener 1","child exit code 1"], exit code 0
    child, a listener and then an exception at the top level of an ES module: ["exit listener 1","child exit code 1"], exit code 0
    child, a listener that throws and two more on() in one turn: ["late first","exit listener 1","child exit code 1"], exit code 0
    parent, a listener and then an exception that nobody handles: ["exit listener 1"], exit code 1
    parent, a listener added in 'exit': ["exit","close"], exit code 0
    child, on() down to the stack limit before the first tick: ["RangeError function","tick","exit listener 0","child exit code 0"], exit code 0
    "
  `);
});
