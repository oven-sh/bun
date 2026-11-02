import { describe, expect, test } from "bun:test";
import { isASAN } from "harness";

// structuredClone stays inside the agent cluster, so SharedArrayBuffers share
// their backing store like node and the HTML spec's StructuredSerialize.
describe("structuredClone(SharedArrayBuffer)", () => {
  test("clone is a SharedArrayBuffer sharing memory", () => {
    const sab = new SharedArrayBuffer(8);
    const clone = structuredClone(sab);
    expect(clone).toBeInstanceOf(SharedArrayBuffer);
    expect(clone.byteLength).toBe(8);
    new Uint8Array(sab)[0] = 42;
    expect(new Uint8Array(clone)[0]).toBe(42);
    new Uint8Array(clone)[1] = 7;
    expect(new Uint8Array(sab)[1]).toBe(7);
  });

  test("SAB nested in an object shares through the clone", () => {
    const sab = new SharedArrayBuffer(4);
    const out = structuredClone({ deep: [sab] });
    expect(out.deep[0]).toBeInstanceOf(SharedArrayBuffer);
    new Uint8Array(sab)[0] = 9;
    expect(new Uint8Array(out.deep[0])[0]).toBe(9);
  });

  test("worker postMessage shares the SAB", async () => {
    const sab = new SharedArrayBuffer(4);
    const worker = new Worker(
      URL.createObjectURL(
        new Blob(
          [
            `self.onmessage = ({ data }) => {
               new Uint8Array(data)[0] = 42;
               postMessage("done");
             };`,
          ],
          { type: "application/javascript" },
        ),
      ),
    );
    try {
      const { promise, resolve, reject } = Promise.withResolvers();
      worker.onmessage = resolve;
      worker.onerror = reject;
      worker.postMessage(sab);
      await promise;
      expect(new Uint8Array(sab)[0]).toBe(42);
    } finally {
      worker.terminate();
    }
  });
});

test.skipIf(isASAN /* WebAssembly.Memory ignores `shared` */)(
  "cloning a shared WebAssembly.Memory with a maximum of zero keeps it zero-sized and shared",
  async () => {
    const zero = () => new WebAssembly.Memory({ initial: 0, maximum: 0, shared: true });
    const { port1, port2 } = new MessageChannel();
    const { promise, resolve } = Promise.withResolvers<WebAssembly.Memory>();
    port2.onmessage = event => resolve(event.data);
    port1.postMessage(zero());
    for (const memory of [structuredClone(zero()), await promise]) {
      expect(memory).toBeInstanceOf(WebAssembly.Memory);
      expect(memory.buffer).toBeInstanceOf(SharedArrayBuffer);
      expect(memory.buffer.byteLength).toBe(0);
    }
    port1.close();
    port2.close();
  },
);
