import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, isASAN } from "harness";
import { join } from "node:path";

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

// An i64 module links only on an i64 memory, so a clone has to keep the address type of its source.
// Memory64 is a startup option: each case runs in a child.
describe.concurrent("cloning a shared WebAssembly.Memory keeps its address type", () => {
  const env = { ...bunEnv, BUN_JSC_useWasmMemory64: "1" };

  test("on every route", async () => {
    await using proc = Bun.spawn({
      cmd: [bunExe(), join(import.meta.dir, "structured-clone-shared-wasm-memory-fixture.mjs")],
      env,
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

    const i64 = "i64, i64 module links, i32 module LinkError";
    const i32 = "i32, i64 module LinkError, i32 module links";
    const expected = {
      structuredClone: {
        i64,
        i32,
        "clone of a clone": i64,
        "both in one message": [i64, "after i64", i32, "after i32"],
      },
      MessageChannel: { receiveMessageOnPort: i64, "message event": i64 },
      BroadcastChannel: [i64, i64],
      "Web Worker": { received: i64, "sent back": i64 },
      "node:worker_threads": {
        workerData: { i64, i32 },
        environmentData: i64,
        postMessage: i64,
        "parentPort.postMessage": i64,
      },
      counter: { "main thread": 1000, Worker: 2000 },
    };
    expect({ stdout, stderr, exitCode }).toEqual({
      stdout: JSON.stringify(expected, null, 2) + "\n",
      stderr: "",
      exitCode: 0,
    });
  });

  test("with a maximum of zero", async () => {
    await using proc = Bun.spawn({
      cmd: [
        bunExe(),
        "-e",
        `for (const address of ["i32", "i64"]) {
           const zero = address === "i64" ? 0n : 0;
           const memory = new WebAssembly.Memory({ address, initial: zero, maximum: zero, shared: true });
           for (const m of [memory, structuredClone(memory)])
             console.log(address, typeof m.grow(zero), m.buffer.constructor.name, m.buffer.byteLength);
         }`,
      ],
      env,
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect({ stdout, stderr, exitCode }).toEqual({
      stdout: [
        "i32 number SharedArrayBuffer 0",
        "i32 number SharedArrayBuffer 0",
        "i64 bigint SharedArrayBuffer 0",
        "i64 bigint SharedArrayBuffer 0",
        "",
      ].join("\n"),
      stderr: "",
      exitCode: 0,
    });
  });
});
