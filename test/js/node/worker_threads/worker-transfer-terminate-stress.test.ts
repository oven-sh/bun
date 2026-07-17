import { test } from "bun:test";
import { MessageChannel, Worker } from "node:worker_threads";

// Amplified shape of test-worker-message-port-transfer-terminate.js, which
// SIGABRTs intermittently on the x64-asan lane only ("ASSERTION FAILED:
// !scope.exception() || !result" in JSC::JSObject::getOwnPropertyDescriptor,
// JSObject.cpp:3936) - a terminate() landing while a MessagePort transfer is
// serializing. It does not reproduce locally (0/115 loaded runs) and the
// vendored occurrence dies without a stack; under bun:test on the ASAN lane
// a reproduction aborts with a full symbolized report in the test output.
// Same contract as the vendored test: none of this may crash the process.
test("terminate() during MessagePort transfer does not crash", async () => {
  const rounds = 8;
  for (let r = 0; r < rounds; r++) {
    const workers: Worker[] = [];
    for (let i = 0; i < 10; ++i) {
      const w = new Worker("require('worker_threads').parentPort.on('message', () => {})", { eval: true });
      workers.push(w);
      setImmediate(() => {
        const port = new MessageChannel().port1;
        try {
          w.postMessage({ port }, [port]);
        } catch {
          // the worker may already be gone; the contract is only "no crash"
        }
        w.terminate();
      });
    }
    await new Promise(resolve => setImmediate(resolve));
    await Promise.allSettled(workers.map(w => new Promise(res => w.on("exit", res))));
  }
}, 60_000);
