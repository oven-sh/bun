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

  test("postMessage(msg, [MessagePort]) transfers the port", async () => {
    const results = await roundtrip(
      `
        const { port1, port2 } = new MessageChannel();
        try {
          self.postMessage(port1, [port1]);
          port2.postMessage("via-port");
        } catch (err) {
          self.postMessage({ err: String(err) });
        }
      `,
      1,
    );
    expect(results[0]).toBeInstanceOf(MessagePort);
    const { promise, resolve } = Promise.withResolvers<string>();
    results[0].onmessage = (e: MessageEvent) => resolve(e.data);
    expect(await promise).toBe("via-port");
    results[0].close();
  });
});
