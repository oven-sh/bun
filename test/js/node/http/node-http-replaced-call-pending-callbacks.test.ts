import { expect, test } from "bun:test";
import { bunEnv, bunExe } from "harness";
import { join } from "node:path";

test("write() and end() of a server's response call its _callPendingCallbacks, wherever a program has replaced it", async () => {
  await using proc = Bun.spawn({
    cmd: [bunExe(), join(import.meta.dir, "node-http-replaced-call-pending-callbacks-fixture.ts")],
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  expect(stderr).toBe("");
  expect(stdout).toBe(`replaced nowhere, end(body): 200 ok
replaced nowhere, write(), end(body): 200 ok
replaced nowhere, a content-length, write(), end(): 200 ok
replaced nowhere, write() and end() with callbacks: 200 ok
    the callback of write()
    the callback of end()
replaced on the response, end(body): 200 ok
    _callPendingCallbacks(), finished true, headersSent true
replaced on the response, write(), end(body): 200 ok
    _callPendingCallbacks(), finished false, headersSent true
    _callPendingCallbacks(), finished true, headersSent true
replaced on the response, a content-length, write(), end(): 200 ok
    _callPendingCallbacks(), finished false, headersSent true
    _callPendingCallbacks(), finished true, headersSent true
replaced on the response, write() and end() with callbacks: 200 ok
    _callPendingCallbacks(), finished false, headersSent true
    _callPendingCallbacks(), finished true, headersSent true
    the callback of write()
    the callback of end()
replaced on ServerResponse.prototype, end(body): 200 ok
    _callPendingCallbacks(), finished true, headersSent true
replaced on ServerResponse.prototype, write(), end(body): 200 ok
    _callPendingCallbacks(), finished false, headersSent true
    _callPendingCallbacks(), finished true, headersSent true
replaced on ServerResponse.prototype, a content-length, write(), end(): 200 ok
    _callPendingCallbacks(), finished false, headersSent true
    _callPendingCallbacks(), finished true, headersSent true
replaced on ServerResponse.prototype, write() and end() with callbacks: 200 ok
    _callPendingCallbacks(), finished false, headersSent true
    _callPendingCallbacks(), finished true, headersSent true
    the callback of write()
    the callback of end()
replaced on an heir of ServerResponse.prototype, end(body): 200 ok
    _callPendingCallbacks(), finished true, headersSent true
replaced on an heir of ServerResponse.prototype, write(), end(body): 200 ok
    _callPendingCallbacks(), finished false, headersSent true
    _callPendingCallbacks(), finished true, headersSent true
replaced on an heir of ServerResponse.prototype, a content-length, write(), end(): 200 ok
    _callPendingCallbacks(), finished false, headersSent true
    _callPendingCallbacks(), finished true, headersSent true
replaced on an heir of ServerResponse.prototype, write() and end() with callbacks: 200 ok
    _callPendingCallbacks(), finished false, headersSent true
    _callPendingCallbacks(), finished true, headersSent true
    the callback of write()
    the callback of end()
replaced on the response by a listener of prefinish, end(body): 200 ok
    _callPendingCallbacks(), finished true, headersSent true
replaced on the response by a listener of prefinish, write(), end(body): 200 ok
    _callPendingCallbacks(), finished true, headersSent true
replaced on the response by a listener of prefinish, a content-length, write(), end(): 200 ok
    _callPendingCallbacks(), finished true, headersSent true
replaced on the response by a listener of prefinish, write() and end() with callbacks: 200 ok
    _callPendingCallbacks(), finished true, headersSent true
    the callback of write()
    the callback of end()
replaced on the response, which has listeners, end(body): 200 ok
    prefinish
    _callPendingCallbacks(), finished true, headersSent true
    finish
    close
replaced on the response, which has listeners, write(), end(body): 200 ok
    _callPendingCallbacks(), finished false, headersSent true
    prefinish
    _callPendingCallbacks(), finished true, headersSent true
    finish
    close
replaced on the response, which has listeners, a content-length, write(), end(): 200 ok
    _callPendingCallbacks(), finished false, headersSent true
    prefinish
    _callPendingCallbacks(), finished true, headersSent true
    finish
    close
replaced on the response, which has listeners, write() and end() with callbacks: 200 ok
    _callPendingCallbacks(), finished false, headersSent true
    prefinish
    _callPendingCallbacks(), finished true, headersSent true
    the callback of write()
    finish
    the callback of end()
    close
`);
  expect(exitCode).toBe(0);
});
