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

// Open: a clone of a shared memory's growable buffer grows the memory by a part of a page.
// `clone.grow(65537)` returns, where the memory's own buffer throws a RangeError. After it,
// memory.buffer.byteLength is 65537 and wasm code sees 2 pages. JavaScriptCore takes the page rule
// from a flag that the clone does not have: https://github.com/oven-sh/WebKit/pull/900
// The `test.failing` cases fail until a WebKit upgrade brings a fix. Then change them to `test`.
// The first one holds for every fix. The other two expect what V8 does: the grow is a RangeError.
// Bun has its own copy of the clone reader (`case SharedArrayBufferTag` in SerializedScriptValue.cpp),
// so a fix in JavaScriptCore's reader alone does not change these results (#46773).
// The cases run in a child: on an ASAN build `shared: true` needs an ASAN option that bunEnv sets.
describe.concurrent("a clone of a shared WebAssembly.Memory's growable buffer", () => {
  const run = async (...args: string[]) => {
    await using proc = Bun.spawn({ cmd: [bunExe(), ...args], env: bunEnv, stdout: "pipe", stderr: "pipe" });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    return { stdout, stderr, exitCode };
  };

  test.failing("keeps the byte length of the memory a page multiple", async () => {
    const script = `
      const memory = new WebAssembly.Memory({ initial: 1, maximum: 4, shared: true });
      // A fix can refuse the clone, return a fixed-length clone, or refuse the grow. Another error is not a fix.
      try {
        const clone = structuredClone(memory.toResizableBuffer());
        if (clone.growable) clone.grow(65537);
      } catch (e) {
        if (e.name !== "DataCloneError" && e.name !== "RangeError") throw e;
      }
      const { buffer } = memory;
      console.log(buffer instanceof SharedArrayBuffer ? buffer.byteLength % 65536 : "the memory is not shared");`;
    expect(await run("-e", script)).toEqual({ stdout: "0\n", stderr: "", exitCode: 0 });
  });

  // The fixture asks each clone for one byte more, then for one page more. Each pair of cases reads one run.
  const fixture = join(import.meta.dir, "structured-clone-growable-wasm-buffer-fixture.mjs");
  const once = (...args: string[]) => {
    let result: ReturnType<typeof run> | undefined;
    return () => (result ??= run(fixture, ...args));
  };
  const printed = async (fixtureRun: () => ReturnType<typeof run>) => {
    const { stdout, stderr, exitCode } = await fixtureRun();
    expect({ stderr, exitCode }).toEqual({ stderr: "", exitCode: 0 });
    return JSON.parse(stdout);
  };
  const each = (routes: string[], outcome: string) => Object.fromEntries(routes.map(route => [route, outcome]));
  // What the fixture prints for a memory of this size: its own API and wasm code agree, and both still grow it.
  const memory = (pages: number) => ({
    "memory.size instruction": pages,
    "memory.buffer pages": pages,
    "Memory.prototype.grow(1)": pages,
    "memory.grow instruction": pages + 1,
  });

  const onOneThread = once();
  const onOneThreadRoutes = [
    "structuredClone of the buffer",
    "structuredClone of a length-tracking Uint8Array",
    "structuredClone of a DataView in an object",
    "structuredClone of a clone",
    "MessageChannel, receiveMessageOnPort",
    "MessageChannel, message event",
    "BroadcastChannel, first listener",
    "BroadcastChannel, second listener",
  ];

  test("is growable and adds a page to the memory (structuredClone, MessageChannel, BroadcastChannel)", async () => {
    expect(await printed(onOneThread)).toEqual({
      "1 byte more": expect.any(Object), // the next case
      "1 page more": each(onOneThreadRoutes, "growable, grows"),
      controls: {
        "a memory with no clone": memory(1),
        "the clone of a memory's fixed-length buffer is growable": false,
        "bytes of a plain growable SharedArrayBuffer of 8 bytes after its clone grows it by 1 byte": 9,
      },
      // The memory had one page, and each of the 8 clones added one.
      "the memory after the clones": { "memory.buffer is the cloned buffer": true, ...memory(9) },
    });
  });

  test.failing("refuses one byte more (structuredClone, MessageChannel, BroadcastChannel)", async () => {
    expect((await printed(onOneThread))["1 byte more"]).toEqual(each(onOneThreadRoutes, "RangeError"));
  });

  const withWorker = once("worker");
  const withWorkerRoutes = ["workerData", "environmentData", "worker.postMessage", "parentPort.postMessage"];

  test("is growable and adds a page to the memory (to and from a Worker)", async () => {
    expect(await printed(withWorker)).toEqual({
      "1 byte more": expect.any(Object), // the next case
      "1 page more": each(withWorkerRoutes, "growable, grows"),
      // The memory had one page, and each of the 4 clones added one. The Worker grew it three times.
      "the memory after the clones": { "memory.buffer is the cloned buffer": true, ...memory(5) },
    });
  });

  test.failing("refuses one byte more (to and from a Worker)", async () => {
    expect((await printed(withWorker))["1 byte more"]).toEqual(each(withWorkerRoutes, "RangeError"));
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
