import { expect, test } from "bun:test";
import { MessageChannel, Worker } from "node:worker_threads";

test("MessagePort.postMessage() returns true, or undefined when the port is closed/detached", async () => {
  // open peer
  {
    const { port1, port2 } = new MessageChannel();
    port1.on("message", () => {});
    expect(port2.postMessage("x")).toBe(true);
    expect(port2.postMessage("x", [])).toBe(true);
    expect(port2.postMessage("x", { transfer: [] })).toBe(true);
    port1.close();
    port2.close();
  }
  // peer closed: still true synchronously (close hasn't propagated yet),
  // then undefined once the 'close' event has fired on this side
  {
    const { port1, port2 } = new MessageChannel();
    const closed = new Promise<void>(resolve => port2.on("close", () => resolve()));
    port1.close();
    expect(port2.postMessage("y")).toBe(true);
    await closed;
    expect(port2.postMessage("y2")).toBe(undefined);
    port2.close();
  }
  // own port closed: undefined
  {
    const { port1, port2 } = new MessageChannel();
    port2.close();
    expect(port2.postMessage("z")).toBe(undefined);
    port1.close();
  }
  // own port transferred away: undefined
  {
    const a = new MessageChannel();
    const b = new MessageChannel();
    b.port1.on("message", () => {});
    expect(b.port2.postMessage("t", [a.port1])).toBe(true);
    expect(a.port1.postMessage("after-transfer")).toBe(undefined);
    a.port2.close();
    b.port1.close();
    b.port2.close();
  }
  // parentPort.postMessage() inside a worker returns true
  {
    const w = new Worker(
      `const { parentPort } = require("node:worker_threads");
       parentPort.postMessage(parentPort.postMessage("x"));`,
      { eval: true },
    );
    try {
      const results: any[] = [];
      await new Promise<void>((resolve, reject) => {
        w.on("message", m => {
          results.push(m);
          if (results.length === 2) resolve();
        });
        w.on("error", reject);
      });
      expect(results).toEqual(["x", true]);
    } finally {
      await w.terminate();
    }
  }
});
