import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe } from "harness";
import { MessageChannel, MessagePort, receiveMessageOnPort } from "node:worker_threads";

// Node's MessagePort.close() retains the already-received queue until the
// deferred uv close callback fires, so same-tick receiveMessageOnPort can
// still drain it.
describe("MessagePort.close() retains already-queued messages", () => {
  test("receiveMessageOnPort drains the queue after close()", () => {
    const { port1, port2 } = new MessageChannel();
    port2.postMessage("q1");
    port2.postMessage("q2");
    port2.postMessage("q3");
    expect(receiveMessageOnPort(port1)).toStrictEqual({ message: "q1" });
    port1.close();
    expect(receiveMessageOnPort(port1)).toStrictEqual({ message: "q2" });
    expect(receiveMessageOnPort(port1)).toStrictEqual({ message: "q3" });
    expect(receiveMessageOnPort(port1)).toBe(undefined);
    port2.close();
  });

  test("transferred port queued at close() time is usable via receiveMessageOnPort", () => {
    const { port1, port2 } = new MessageChannel();
    const { port1: ip1, port2: ip2 } = new MessageChannel();
    port2.postMessage({ inner: ip1 }, [ip1]);
    port1.close();
    const r = receiveMessageOnPort(port1) as { message: { inner: MessagePort } };
    expect(r).toBeDefined();
    r.message.inner.postMessage("via-inner");
    expect(receiveMessageOnPort(ip2)).toStrictEqual({ message: "via-inner" });
    r.message.inner.close();
    ip2.close();
    port2.close();
  });

  test.concurrent("a drain scheduled before close() does not consume the retained inbox", async () => {
    await using proc = Bun.spawn({
      cmd: [
        bunExe(),
        "-e",
        `
          const { MessageChannel, receiveMessageOnPort } = require("node:worker_threads");
          const { port1, port2 } = new MessageChannel();
          const got = [];
          port1.on("message", m => got.push(m));   // started: a drain is scheduled on send()
          port2.postMessage("a");
          port2.postMessage("b");
          port1.close();
          const sync = receiveMessageOnPort(port1);
          setImmediate(() => {
            // The stale drain must have bailed (node's uv_close cancels the
            // pending uv_async); the inbox is still here for rmo and nothing
            // was delivered to the listener.
            console.log(JSON.stringify({ got, sync, after: receiveMessageOnPort(port1) }));
            port2.close();
          });
        `,
      ],
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect(stderr).toBe("");
    const out = JSON.parse(stdout.trim());
    // Node still returns "b" at the first setImmediate (uv close callbacks fire
    // after the check phase); bun drops it one phase earlier. Either way the
    // listener was never called and same-tick rmo returned "a".
    expect({ got: out.got, sync: out.sync }).toEqual({ got: [], sync: { message: "a" } });
    expect(exitCode).toBe(0);
  });

  test.concurrent("the retained queue is dropped once the deferred close runs", async () => {
    await using proc = Bun.spawn({
      cmd: [
        bunExe(),
        "-e",
        `
          const { MessageChannel, receiveMessageOnPort } = require("node:worker_threads");
          const { port1, port2 } = new MessageChannel();
          port2.postMessage("a");
          port2.postMessage("b");
          port1.close();
          const sync = receiveMessageOnPort(port1);
          // Node drops the inbox in the uv close-callbacks phase, which runs
          // after setImmediate; two nested setImmediates land past that in
          // both runtimes.
          setImmediate(() => setImmediate(() => {
            console.log(JSON.stringify({ sync, after: receiveMessageOnPort(port1) }));
            port2.close();
          }));
        `,
      ],
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect(stderr).toBe("");
    expect(JSON.parse(stdout.trim())).toEqual({ sync: { message: "a" } });
    expect(exitCode).toBe(0);
  });
});
