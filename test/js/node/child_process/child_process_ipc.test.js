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
    "child, process.send(): ["first","second","end"]
    child, process.on('disconnect'): ["first","second","end"]
    child, a listener that was removed: ["first","second","end"]
    child, process.once('message') that fired: ["second","end"]
    child, a listener that throws: ["first","second","end"]
    child, after 'disconnect': []
    parent: ["first","second","end"]
    parent, a listener that throws: ["first","second","end"]
    parent, after 'disconnect': []
    "
  `);
});
