// Worker-side self.postMessage(message, transfer) overload resolution.
//
// jsFunctionPostMessage() must accept both postMessage(msg, [transferable]) and
// postMessage(msg, { transfer: [transferable] }) just like the parent-side
// Worker#postMessage / MessagePort#postMessage do. Previously the array form
// was treated as an options object whose .transfer is undefined, so buffers
// were cloned (not detached) and MessagePorts failed to serialize.
//
// https://github.com/oven-sh/bun/issues/18705
// https://github.com/oven-sh/bun/issues/23294
// https://github.com/oven-sh/bun/issues/15931

import { describe, expect, test } from "bun:test";

describe("self.postMessage transfer list", () => {
  async function roundtrip(body: string, expectedMessages: number) {
    const url = URL.createObjectURL(new Blob([body]));
    const worker = new Worker(url);
    try {
      const results: any[] = [];
      const { promise, resolve, reject } = Promise.withResolvers<any[]>();
      worker.onerror = e => reject(e.error ?? e.message ?? e);
      worker.onmessage = e => {
        results.push(e.data);
        if (results.length === expectedMessages) resolve(results);
      };
      return await promise;
    } finally {
      worker.terminate();
      URL.revokeObjectURL(url);
    }
  }

  test("postMessage(msg, [ArrayBuffer]) transfers and detaches the buffer", async () => {
    const results = await roundtrip(
      `
        const buf = new ArrayBuffer(16);
        new Uint8Array(buf).fill(7);
        self.postMessage(buf, [buf]);
        self.postMessage({ detached: buf.byteLength === 0 });
      `,
      2,
    );
    expect(results[0]).toBeInstanceOf(ArrayBuffer);
    expect(results[0].byteLength).toBe(16);
    expect(new Uint8Array(results[0])[0]).toBe(7);
    expect(results[1]).toEqual({ detached: true });
  });

  test("postMessage(msg, { transfer: [ArrayBuffer] }) transfers and detaches the buffer", async () => {
    const results = await roundtrip(
      `
        const buf = new ArrayBuffer(16);
        self.postMessage(buf, { transfer: [buf] });
        self.postMessage({ detached: buf.byteLength === 0 });
      `,
      2,
    );
    expect(results[0]).toBeInstanceOf(ArrayBuffer);
    expect(results[0].byteLength).toBe(16);
    expect(results[1]).toEqual({ detached: true });
  });

  // https://html.spec.whatwg.org/multipage/workers.html#dom-dedicatedworkerglobalscope-postmessage
  // The transfer list is a WebIDL sequence<object>: an invalid entry throws a
  // TypeError before serialization, so nothing in the list gets detached.
  test("postMessage(msg, [ArrayBuffer, null]) throws TypeError and detaches nothing", async () => {
    const results = await roundtrip(
      `
        const buf = new ArrayBuffer(16);
        let name = "no throw";
        try {
          self.postMessage(buf, [buf, null]);
        } catch (err) {
          name = err.constructor.name;
        }
        self.postMessage({ name, byteLength: buf.byteLength });
      `,
      1,
    );
    expect(results[0]).toEqual({ name: "TypeError", byteLength: 16 });
  });

  test("postMessage(msg, invalidOptions) throws TypeError", async () => {
    const results = await roundtrip(
      `
        const names = [];
        for (const options of [42, "abc", { transfer: 42 }, { transfer: [null] }]) {
          try {
            self.postMessage("x", options);
            names.push("no throw");
          } catch (err) {
            names.push(err.constructor.name);
          }
        }
        self.postMessage(names);
      `,
      1,
    );
    expect(results[0]).toEqual(["TypeError", "TypeError", "TypeError", "TypeError"]);
  });

  test("postMessage(msg, [MessagePort]) transfers the port", async () => {
    // Don't reuse roundtrip() here: it terminates the worker as soon as the
    // first message lands, which can race the port-channel delivery. Keep the
    // worker alive until the transferred port has received its message.
    const url = URL.createObjectURL(
      new Blob([
        `
          const { port1, port2 } = new MessageChannel();
          // Queue the message into port1's buffer *before* transferring it so
          // it travels with the port regardless of worker-teardown timing.
          port2.postMessage("via-port");
          try {
            self.postMessage(port1, [port1]);
          } catch (err) {
            self.postMessage({ err: String(err) });
          }
        `,
      ]),
    );
    const worker = new Worker(url);
    try {
      const first = await new Promise<any>((resolve, reject) => {
        worker.onerror = e => reject(e.error ?? e.message ?? e);
        worker.onmessage = e => resolve(e.data);
      });
      expect(first).toBeInstanceOf(MessagePort);
      const received = await new Promise<string>(resolve => {
        first.onmessage = (e: MessageEvent) => resolve(e.data);
      });
      expect(received).toBe("via-port");
      first.close();
    } finally {
      worker.terminate();
      URL.revokeObjectURL(url);
    }
  });

  // Transferring a port closes the sender's object (node fires 'close' on it, asynchronously).
  // Worker#postMessage and the worker-side self.postMessage each disentangle the port
  // themselves, so both directions are checked.
  test("a port transferred with postMessage fires 'close' on the sender's object, in both directions", async () => {
    const url = URL.createObjectURL(
      new Blob([
        `
          const { port1 } = new MessageChannel();
          const events = [];
          port1.addEventListener("close", () => events.push("close"));
          self.postMessage(port1, [port1]);
          events.push("postMessage returned");
          setImmediate(() => setImmediate(() => self.postMessage(events)));
        `,
      ]),
    );
    const worker = new Worker(url);
    try {
      const messages: any[] = [];
      const workerEvents = new Promise<string[]>((resolve, reject) => {
        worker.onerror = e => reject(e.error ?? e.message ?? e);
        worker.onmessage = e => {
          messages.push(e.data);
          if (Array.isArray(e.data)) resolve(e.data);
        };
      });

      const { port1 } = new MessageChannel();
      const events: string[] = [];
      port1.addEventListener("close", () => events.push("close"));
      worker.postMessage(port1, [port1]);
      events.push("postMessage returned");
      await new Promise(r => setImmediate(() => setImmediate(r)));
      expect(events).toEqual(["postMessage returned", "close"]);

      expect(await workerEvents).toEqual(["postMessage returned", "close"]);
      expect(messages[0]).toBeInstanceOf(MessagePort);
    } finally {
      worker.terminate();
      URL.revokeObjectURL(url);
    }
  });
});
