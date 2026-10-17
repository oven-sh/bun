import { $ } from "bun";
import { bunExe } from "harness";

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
  const output = await $`${bunExe()} ${import.meta.dir}/fixtures/ipc-pending-messages-fixture.mjs`.text();
  // node (v26.7.0) has identical output, except that a listener that throws gets ["first","first","end"]
  expect(output).toMatchInlineSnapshot(`
    "child, a late listener: ["first","second","end"]
    child, a handle: [["first","Server"],"second","end"]
    child, a listener that throws: ["first","second","end"]
    child, once: ["first","end"]
    child, added and removed in one tick: ["first","second","end"]
    child, disconnect() in the tick that adds it: []
    parent, a late listener: ["first","second","end"]
    parent, a handle: [["first","Server"],"second","end"]
    parent, a listener that throws: ["first","end"]
    parent, once: ["first","end"]
    parent, added and removed in one tick: ["first","second","end"]
    parent, disconnect() in the tick that adds it: []
    "
  `);
});
