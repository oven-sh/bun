import { expect, test } from "bun:test";
import { MessageChannel, Worker } from "node:worker_threads";

test("MessagePort.postMessage() returns true, or undefined when the port is closed/detached", async () => {
  // open peer
  {
    const { port1, port2 } = new MessageChannel();
    try {
      port1.on("message", () => {});
      expect(port2.postMessage("x")).toBe(true);
      expect(port2.postMessage("x", [])).toBe(true);
      expect(port2.postMessage("x", { transfer: [] })).toBe(true);
    } finally {
      port1.close();
      port2.close();
    }
  }
  // peer closed: still true synchronously (close hasn't propagated yet),
  // then undefined once the 'close' event has fired on this side
  {
    const { port1, port2 } = new MessageChannel();
    try {
      const closed = new Promise<void>(resolve => port2.on("close", () => resolve()));
      port1.close();
      expect(port2.postMessage("y")).toBe(true);
      await closed;
      expect(port2.postMessage("y2")).toBe(undefined);
    } finally {
      port2.close();
    }
  }
  // own port closed: undefined
  {
    const { port1, port2 } = new MessageChannel();
    try {
      port2.close();
      expect(port2.postMessage("z")).toBe(undefined);
    } finally {
      port1.close();
    }
  }
  // own port transferred away: undefined
  {
    const a = new MessageChannel();
    const b = new MessageChannel();
    try {
      b.port1.on("message", () => {});
      expect(b.port2.postMessage("t", [a.port1])).toBe(true);
      expect(a.port1.postMessage("after-transfer")).toBe(undefined);
    } finally {
      a.port2.close();
      b.port1.close();
      b.port2.close();
    }
  }
  // own port closed by a getter during serialization: still true (node samples at entry)
  {
    const { port1, port2 } = new MessageChannel();
    try {
      const msg = {
        get x() {
          port2.close();
          return 1;
        },
      };
      expect(port2.postMessage(msg)).toBe(true);
    } finally {
      port1.close();
    }
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
        w.on("message", m => results.push(m));
        w.on("error", reject);
        w.on("exit", code =>
          results.length === 2
            ? resolve()
            : reject(new Error(`worker exited (${code}) with ${results.length} messages`)),
        );
      });
      expect(results).toEqual(["x", true]);
    } finally {
      await w.terminate();
    }
  }
});
