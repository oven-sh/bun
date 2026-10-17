import { $ } from "bun";
import { bunEnv, bunExe } from "harness";

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

test("which channel ref states hold the event loop", async () => {
  const output = await $`${bunExe()} ${import.meta.dir}/fixtures/ipc_channel_ref.mjs`.env(bunEnv).text();
  // node (v26.7.0) has identical output
  expect(output).toMatchInlineSnapshot(`
    "parent: none                                             stays
    parent: child.unref                                      stays
    parent: unref                                            stays
    parent: child.unref unref                                exits
    parent: child.unref unref ref                            stays
    parent: child.unref disconnect                           exits
    parent: child.unref unrefCounted                         stays
    parent: child.unref refCounted unrefCounted              exits
    parent: child.unref refCounted refCounted unrefCounted   stays
    parent: child.unref unref refCounted                     exits
    parent: child.unref ref refCounted unrefCounted          stays
    child:  none                                                                       exits
    child:  on(message,a)                                                              stays
    child:  once(message,a)                                                            stays
    child:  on(disconnect,a)                                                           stays
    child:  on(message,a) off(message,a)                                               exits
    child:  on(message,a) on(message,b) off(message,a)                                 stays
    child:  on(message,a) on(message,b) removeAll(message)                             exits
    child:  on(message,a) unrefCounted                                                 exits
    child:  on(message,a) on(disconnect,a) unrefCounted                                stays
    child:  on(message,a) on(disconnect,a) unrefCounted unrefCounted                   exits
    child:  on(message,a) on(message,b) unrefCounted removeAll(message) on(message,a)  exits
    child:  refCounted                                                                 stays
    child:  refCounted unrefCounted                                                    exits
    child:  unrefCounted refCounted                                                    exits
    child:  unrefCounted on(message,a)                                                 exits
    child:  ref                                                                        stays
    child:  ref unrefCounted                                                           stays
    child:  ref on(message,a) off(message,a)                                           stays
    child:  on(message,a) unref                                                        exits
    child:  on(message,a) unref refCounted                                             exits
    child:  unref on(message,a)                                                        exits
    "
  `);
});
