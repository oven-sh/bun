import { heapProfilerHasSnapshot } from "bun:internal-for-testing";
import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { once } from "node:events";
import { join } from "node:path";
import v8 from "node:v8";
import { Worker } from "node:worker_threads";

describe("the heap profiler holds no snapshot once the text of one is made", () => {
  test.each<[string, (dir: string) => unknown]>([
    ["Bun.generateHeapSnapshot()", () => Bun.generateHeapSnapshot()],
    ['Bun.generateHeapSnapshot("jsc")', () => Bun.generateHeapSnapshot("jsc")],
    ['Bun.generateHeapSnapshot("v8")', () => Bun.generateHeapSnapshot("v8")],
    ['Bun.generateHeapSnapshot("v8", "arraybuffer")', () => Bun.generateHeapSnapshot("v8", "arraybuffer")],
    ["v8.getHeapSnapshot()", () => v8.getHeapSnapshot().toArray()],
    ["v8.writeHeapSnapshot()", dir => v8.writeHeapSnapshot(join(dir, "written.heapsnapshot"))],
  ])("%s", async (_, take) => {
    using dir = tempDir("heap-snapshot-is-dropped", {});
    await take(String(dir));
    expect(heapProfilerHasSnapshot()).toBe(false);
  });

  test("console.takeHeapSnapshot()", async () => {
    using dir = tempDir("heap-snapshot-is-dropped", {
      "take.ts": `
        import { heapProfilerHasSnapshot } from "bun:internal-for-testing";
        console.takeHeapSnapshot();
        console.error(heapProfilerHasSnapshot());
      `,
    });
    await using child = Bun.spawn({
      cmd: [bunExe(), "take.ts"],
      env: bunEnv,
      cwd: String(dir),
      stdout: "ignore",
      stderr: "pipe",
    });
    const [stderr, exitCode] = await Promise.all([child.stderr.text(), child.exited]);
    expect({ stderr: stderr.trim(), exitCode }).toEqual({ stderr: "false", exitCode: 0 });
  });

  test("worker.getHeapSnapshot()", async () => {
    const worker = new Worker(
      `
        const { heapProfilerHasSnapshot } = require("bun:internal-for-testing");
        const { parentPort } = require("node:worker_threads");
        parentPort.on("message", () => parentPort.postMessage(heapProfilerHasSnapshot()));
      `,
      { eval: true },
    );
    try {
      await (await worker.getHeapSnapshot()).toArray();
      worker.postMessage("ask");
      expect(await once(worker, "message")).toEqual([false]);
    } finally {
      await worker.terminate();
    }
  });
});

test("the inspector's snapshot stays until the inspector lets go of it", async () => {
  using dir = tempDir("heap-snapshot-is-dropped", {
    "inspected.ts": `
      import { heapProfilerHasSnapshot } from "bun:internal-for-testing";
      globalThis.heapProfilerHasSnapshot = heapProfilerHasSnapshot;
      setInterval(() => {}, 1000);
      console.log("ready");
    `,
  });
  await using child = Bun.spawn({
    cmd: [bunExe(), "--inspect=ws://127.0.0.1:0/heap", "inspected.ts"],
    env: bunEnv,
    cwd: String(dir),
    stdout: "pipe",
    stderr: "pipe",
  });

  async function firstMatch(stream: ReadableStream<Uint8Array>, pattern: RegExp) {
    const decoder = new TextDecoder();
    let text = "";
    for await (const chunk of stream) {
      text += decoder.decode(chunk, { stream: true });
      const match = pattern.exec(text);
      if (match) return match[0];
    }
    throw new Error(`${pattern} is not in ${JSON.stringify(text)}`);
  }
  const [url] = await Promise.all([
    firstMatch(child.stderr, /ws:\/\/127\.0\.0\.1:\d+\/heap/),
    firstMatch(child.stdout, /ready/),
  ]);

  const socket = new WebSocket(url);
  const answers = new Map<number, (message: any) => void>();
  socket.addEventListener("message", event => {
    const message = JSON.parse(String(event.data));
    answers.get(message.id)?.(message);
  });
  const opened = Promise.withResolvers<void>();
  socket.addEventListener("open", () => opened.resolve(), { once: true });
  socket.addEventListener("error", () => opened.reject(new Error(`the socket to ${url} failed before it opened`)), {
    once: true,
  });
  socket.addEventListener(
    "close",
    event => opened.reject(new Error(`the socket to ${url} closed before it opened, with code ${event.code}`)),
    { once: true },
  );
  await opened.promise;
  let lastId = 0;
  function send(method: string, params = {}) {
    const id = ++lastId;
    const { promise, resolve } = Promise.withResolvers<any>();
    answers.set(id, resolve);
    socket.send(JSON.stringify({ id, method, params }));
    return promise;
  }
  const hasSnapshot = async () =>
    (await send("Runtime.evaluate", { expression: "heapProfilerHasSnapshot()" })).result.result.value;

  try {
    await send("Heap.enable");
    expect(await hasSnapshot()).toBe(false);
    await send("Heap.snapshot");
    expect(await hasSnapshot()).toBe(true);
    await send("Heap.disable");
    expect(await hasSnapshot()).toBe(false);
  } finally {
    socket.close();
  }
});
