import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe } from "harness";

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

// A shared WebAssembly.Memory declared with a maximum of zero has no shared contents,
// so the serializer records a null handle for it and the deserializer re-creates it zero-sized.
describe("shared WebAssembly.Memory with a maximum of zero", () => {
  test("arrives zero-sized and shared through every structured clone entry point", async () => {
    // A subprocess, because a build that dereferences the null handle dies with a SEGV.
    await using proc = Bun.spawn({
      cmd: [
        bunExe(),
        "-e",
        `const zero = () => new WebAssembly.Memory({ initial: 0, maximum: 0, shared: true });
         const report = (door, memory) =>
           console.log(
             door + ": " + Object.prototype.toString.call(memory) +
               " " + memory.buffer.constructor.name + " " + memory.buffer.byteLength,
           );
         const nextMessage = target =>
           new Promise((resolve, reject) => {
             target.onmessage = event => resolve(event.data);
             target.onmessageerror = target.onerror = event => reject(new Error(event.message || event.type));
           });

         report("structuredClone", structuredClone(zero()));
         report("structuredClone, nested", structuredClone({ a: 1, memory: zero() }).memory);

         const { port1, port2 } = new MessageChannel();
         port1.postMessage(zero());
         report("MessagePort", await nextMessage(port2));
         port1.close();
         port2.close();

         const sender = new BroadcastChannel("zero");
         const receiver = new BroadcastChannel("zero");
         const broadcast = nextMessage(receiver);
         sender.postMessage(zero());
         report("BroadcastChannel", await broadcast);
         sender.close();
         receiver.close();

         // The worker echoes its workerData, then each message.
         const worker = new Worker(
           URL.createObjectURL(
             new Blob(
               [
                 'import { workerData } from "node:worker_threads";' +
                   "postMessage(workerData);" +
                   "self.onmessage = ({ data }) => postMessage(data);",
               ],
               { type: "application/javascript" },
             ),
           ),
           { workerData: zero() },
         );
         report("workerData", await nextMessage(worker));
         worker.postMessage(zero());
         report("Worker", await nextMessage(worker));
         worker.terminate();`,
      ],
      env: bunEnv,
      stdin: "ignore",
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

    expect({ stdout: stdout.trim().split("\n"), stderr, signalCode: proc.signalCode, exitCode }).toEqual({
      stdout: [
        "structuredClone",
        "structuredClone, nested",
        "MessagePort",
        "BroadcastChannel",
        "workerData",
        "Worker",
      ].map(door => door + ": [object WebAssembly.Memory] SharedArrayBuffer 0"),
      stderr: "",
      signalCode: null,
      exitCode: 0,
    });
  });
});
