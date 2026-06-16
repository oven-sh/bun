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
});

// Transferable streams: a ReadableStream listed in the transfer list is detached
// into a cross-realm transform and reconstructed on the receiving side, so data
// written to the source is readable through the transferred stream.
// https://github.com/oven-sh/bun/issues/32397
describe("ReadableStream transfer", () => {
  test("carries data across a MessageChannel and detaches the source", async () => {
    const { port1, port2 } = new MessageChannel();
    const rs = new ReadableStream({
      start(c) {
        c.enqueue("a");
        c.enqueue("b");
        c.enqueue("c");
        c.close();
      },
    });

    const { promise, resolve, reject } = Promise.withResolvers<unknown[]>();
    port2.onmessage = async (e: MessageEvent) => {
      try {
        const stream = e.data;
        expect(stream).toBeInstanceOf(ReadableStream);
        const chunks: unknown[] = [];
        for await (const chunk of stream) chunks.push(chunk);
        resolve(chunks);
      } catch (err) {
        reject(err);
      }
    };
    port2.start();

    port1.postMessage(rs, [rs]);
    // The source stream is locked/detached immediately after transfer.
    expect(rs.locked).toBe(true);

    expect(await promise).toEqual(["a", "b", "c"]);
    port1.close();
    port2.close();
  });

  test("preserves order and backpressure across many chunks", async () => {
    const { port1, port2 } = new MessageChannel();
    const N = 1000;
    const rs = new ReadableStream({
      start(c) {
        for (let i = 0; i < N; i++) c.enqueue(i);
        c.close();
      },
    });

    const { promise, resolve, reject } = Promise.withResolvers<number[]>();
    port2.onmessage = async (e: MessageEvent) => {
      try {
        const received: number[] = [];
        for await (const chunk of e.data) received.push(chunk as number);
        resolve(received);
      } catch (err) {
        reject(err);
      }
    };
    port2.start();

    port1.postMessage(rs, [rs]);
    const received = await promise;
    expect(received).toHaveLength(N);
    expect(received).toEqual(Array.from({ length: N }, (_, i) => i));
    port1.close();
    port2.close();
  });

  test("propagates a source error to the receiving stream", async () => {
    const { port1, port2 } = new MessageChannel();
    const rs = new ReadableStream({
      start(c) {
        c.error(new Error("boom"));
      },
    });

    const { promise, resolve, reject } = Promise.withResolvers<string>();
    port2.onmessage = async (e: MessageEvent) => {
      try {
        for await (const _ of e.data);
        reject(new Error("expected the transferred stream to error"));
      } catch (err: any) {
        resolve(String(err?.message ?? err));
      }
    };
    port2.start();

    port1.postMessage(rs, [rs]);
    expect(await promise).toBe("boom");
    port1.close();
    port2.close();
  });

  test("throws DataCloneError when the stream is locked", () => {
    const rs = new ReadableStream();
    rs.getReader();
    const { port1, port2 } = new MessageChannel();
    expect(() => port1.postMessage(rs, [rs])).toThrow(expect.objectContaining({ name: "DataCloneError" }));
    port1.close();
    port2.close();
  });

  test("throws DataCloneError when transferring a stream that is not cloneable without transfer", () => {
    const rs = new ReadableStream();
    const { port1, port2 } = new MessageChannel();
    expect(() => port1.postMessage(rs)).toThrow(expect.objectContaining({ name: "DataCloneError" }));
    port1.close();
    port2.close();
  });

  test("transfers to a Worker and carries data across threads", async () => {
    const url = URL.createObjectURL(
      new Blob([
        `
          self.onmessage = async e => {
            try {
              const chunks = [];
              for await (const chunk of e.data.stream) chunks.push(chunk);
              self.postMessage({ chunks });
            } catch (err) {
              self.postMessage({ error: String(err) });
            }
          };
        `,
      ]),
    );
    const worker = new Worker(url);
    try {
      const { promise, resolve, reject } = Promise.withResolvers<any>();
      worker.onerror = e => reject(e.error ?? e.message ?? e);
      worker.onmessage = e => resolve(e.data);

      const rs = new ReadableStream({
        start(c) {
          c.enqueue("x");
          c.enqueue("y");
          c.enqueue("z");
          c.close();
        },
      });
      worker.postMessage({ stream: rs }, [rs]);
      expect(rs.locked).toBe(true);

      expect(await promise).toEqual({ chunks: ["x", "y", "z"] });
    } finally {
      worker.terminate();
      URL.revokeObjectURL(url);
    }
  });

  test("preserves identity when the same stream is referenced twice", async () => {
    const { port1, port2 } = new MessageChannel();
    const rs = new ReadableStream({
      start(c) {
        c.enqueue("dup");
        c.close();
      },
    });

    const { promise, resolve, reject } = Promise.withResolvers<unknown[]>();
    port2.onmessage = async (e: MessageEvent) => {
      try {
        const { a, b } = e.data;
        expect(a).toBeInstanceOf(ReadableStream);
        // One transferred stream shared by two references must deserialize to
        // the same object, not two streams fighting over one port.
        expect(a).toBe(b);
        const chunks: unknown[] = [];
        for await (const chunk of a) chunks.push(chunk);
        resolve(chunks);
      } catch (err) {
        reject(err);
      }
    };
    port2.start();

    port1.postMessage({ a: rs, b: rs }, [rs]);
    expect(await promise).toEqual(["dup"]);
    port1.close();
    port2.close();
  });

  test("errors the receiver when the source errors with a non-cloneable reason", async () => {
    const { port1, port2 } = new MessageChannel();
    const rs = new ReadableStream({
      start(c) {
        // A function is not structured-cloneable: posting it over the port
        // throws, which must still propagate an error (not hang) to the receiver.
        c.error(() => {});
      },
    });

    const { promise, resolve, reject } = Promise.withResolvers<string>();
    port2.onmessage = async (e: MessageEvent) => {
      try {
        for await (const _ of e.data);
        reject(new Error("expected the transferred stream to error"));
      } catch {
        resolve("errored");
      }
    };
    port2.start();

    port1.postMessage(rs, [rs]);
    expect(await promise).toBe("errored");
    port1.close();
    port2.close();
  });

  test("throws DataCloneError when a getter locks the stream during serialization", () => {
    const rs = new ReadableStream();
    const { port1, port2 } = new MessageChannel();
    // The getter runs while the message is being serialized, locking `rs` after
    // the transfer-list check already passed. The transfer steps must re-check
    // and reject with DataCloneError, not the cross-realm pipe's TypeError.
    const message = {
      get locker() {
        rs.getReader();
        return 1;
      },
      rs,
    };
    expect(() => port1.postMessage(message, [rs])).toThrow(expect.objectContaining({ name: "DataCloneError" }));
    port1.close();
    port2.close();
  });
});
