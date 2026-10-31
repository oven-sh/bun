import { serialize } from "bun:jsc";
import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, isASAN } from "harness";
import { join } from "node:path";
import { serialize as v8Serialize } from "node:v8";

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

// https://html.spec.whatwg.org/multipage/structured-data.html#structuredserializeinternal
// looks a value up in its memory map before it looks at the type of the value, so one
// message holds one clone of each object. The fixture runs in a child because an ASAN
// build only honors `shared: true` with the ASAN_OPTIONS that bunEnv carries.
test("a WebAssembly.Memory or Module repeated in one message is cloned once", async () => {
  await using proc = Bun.spawn({
    cmd: [bunExe(), join(import.meta.dir, "structured-clone-wasm-identity-fixture.ts")],
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  const once = { memory: true, module: true, sameMemory: true, sameModule: true, sameObject: true };
  const contract = { distinctObjectsStayDistinct: true, cloneOfClone: true, separateCallsGiveSeparateClones: true };
  expect(stderr).toBe("");
  expect(JSON.parse(stdout)).toEqual({
    structuredClone: once,
    receiveMessageOnPort: once,
    messagePortEvent: once,
    broadcastChannel: [once, once],
    workerData: once,
    environmentData: once,
    workerPostMessage: once,
    parentPortPostMessage: once,
    webWorker: once,
    windowContextModule: true,
    cloneSharesMemory: true,
    separatePostsGiveSeparateClones: true,
    broadcastReceiversGetSeparateClones: true,
    memory: contract,
    module: contract,
    zeroSizedMemories: true,
    withTransferList: true,
    unsharedError: "DataCloneError",
    backReferenceAt255: true,
    backReferenceAt256: true,
  });
  expect(exitCode).toBe(0);
});

// A WebAssembly.Module is cloned only between threads, where it enters the reference pool.
// A byte payload cannot hold one, and the pool must not turn that rejection into a
// back-reference when the Module repeats.
test.each([
  ["bun:jsc serialize", serialize],
  ["node:v8 serialize", v8Serialize],
])("%s rejects a WebAssembly.Module that is alone or repeated", (_name, toBytes) => {
  const module = new WebAssembly.Module(new Uint8Array([0, 0x61, 0x73, 0x6d, 1, 0, 0, 0]));
  for (const value of [module, [module, module], { a: module, b: module }]) {
    expect(() => toBytes(value)).toThrow(
      expect.objectContaining({ name: "DataCloneError", message: "The object can not be cloned." }),
    );
  }
});
