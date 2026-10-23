import { expect, test } from "bun:test";
import { bunEnv, bunExe, isASAN, isDebug, tempDir } from "harness";

// `post(file)` is the first message of a Worker that runs `file`, once that Worker has ended.
// `post(file, true)` runs it in a `node:worker_threads` Worker.
const post = /* js */ `
  function post(file, node) {
    const { promise, resolve, reject } = Promise.withResolvers();
    let message;
    const ended = () =>
      message ? resolve(message[0]) : reject(new Error(file + " ended before it posted a message"));
    if (node) {
      const worker = new NodeWorker(file);
      worker.on("message", data => {
        message = [data];
        worker.terminate();
      });
      worker.on("error", reject);
      worker.on("exit", ended);
    } else {
      const worker = new Worker(file);
      worker.onmessage = event => {
        message = [event.data];
        worker.terminate();
      };
      worker.onerror = event => reject(new Error(event.message));
      worker.addEventListener("close", ended);
    }
    return promise;
  }
`;

// The allocator hands freed memory back at once: a read of the arena of a Worker that has ended
// then faults on a debug build, and reads zeros on a release build.
const env = { ...bunEnv, MIMALLOC_PURGE_DELAY: "0" };

// With ASAN only arenas allocate from mimalloc: a Worker that has ended leaves exactly nothing, and
// one Worker shows it. Without ASAN every allocation of the process is in those heaps, with some
// noise. A Worker takes much longer to start on a debug build.
const measured = isASAN ? 1 : isDebug ? 2 : 8;

// Runs `measured` Workers to their end, after one more to warm up, in a process that has `define`
// as the value of `VALUE`. Compares the mimalloc heaps of the process before and after them.
async function expectFreed(define: string, node = false) {
  using dir = tempDir("worker-define-freed", {
    "bunfig.toml": `[define]\nVALUE = '${define}'\n`,
    "worker.js": `postMessage(JSON.stringify(VALUE).length);`,
    "main.js": `
      import { heapStats } from "bun:jsc";
      ${node ? `import { Worker as NodeWorker } from "node:worker_threads";` : ""}
      ${post}
      const stats = () => {
        const { heaps } = heapStats({ dump: true }).mimallocDump;
        const inUse = (bytes, page) => bytes + page.used * page.block_size;
        return { heaps: heaps.length, bytes: heaps.reduce((bytes, heap) => heap.pages.reduce(inUse, bytes), 0) };
      };
      const lengths = [await post("./worker.js", ${node})];
      Bun.gc(true);
      const before = stats();
      for (let i = 0; i < ${measured}; i++) lengths.push(await post("./worker.js", ${node}));
      Bun.gc(true);
      const after = stats();
      console.log(
        JSON.stringify({
          lengths: [...new Set(lengths)],
          heaps: after.heaps - before.heaps,
          bytes: after.bytes - before.bytes,
        }),
      );
    `,
  });
  await using proc = Bun.spawn({ cmd: [bunExe(), "main.js"], env, cwd: String(dir), stdout: "pipe", stderr: "pipe" });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  expect(stderr).toBe("");
  const { lengths, heaps, bytes } = JSON.parse(stdout);
  if (isASAN) {
    expect({ lengths, heaps, bytes }).toEqual({ lengths: [define.length], heaps: 0, bytes: 0 });
  } else {
    expect(lengths).toEqual([define.length]);
    expect(bytes).toBeLessThan(measured * 256 * 1024);
  }
  expect(exitCode).toBe(0);
}

// Each Worker parses the `define` values of the process for its own transpiler. The values
// went into the process heap, and nothing freed them when the Worker ended: 576 KiB here.
const string = JSON.stringify(Buffer.alloc(512 * 1024, "x").toString());

test.concurrent("a Worker frees the define values that it parsed", async () => {
  await expectFreed(string);
});

// A `node:worker_threads` Worker takes 1 to 2 seconds to start on a debug build.
test.concurrent.skipIf(isDebug)("a node:worker_threads Worker frees the define values that it parsed", async () => {
  await expectFreed(string, true);
});

test.concurrent("a Worker and a Worker of a Worker read the define values of the process", async () => {
  const define = {
    CFG: `{"a":1,"b":[1,{"c":"d"}]}`,
    GREETING: `"hello world"`,
    ANSWER: `42`,
    NOTHING: `null`,
    ALIAS: `globalThis.Array`,
    "app.config": `{"port":8080}`,
    "process.env.NODE_ENV": `"production"`,
  };
  using dir = tempDir("worker-define-values", {
    "values.js": `export default {
      object: CFG,
      item: CFG.b[1].c,
      string: GREETING,
      number: ANSWER,
      null: NOTHING,
      identifier: ALIAS === Array,
      dotted: app.config.port,
      constant: process.env.NODE_ENV,
    };`,
    "worker.js": `import values from "./values.js"; postMessage(values);`,
    "nested.js": `
      import values from "./values.js";
      const worker = new Worker("./worker.js");
      worker.onmessage = event => postMessage({ worker: values, nested: event.data });
      worker.onerror = event => {
        throw new Error(event.message);
      };
    `,
    "main.js": `
      import values from "./values.js";
      ${post}
      console.log(JSON.stringify({ main: values, ...(await post("./nested.js")) }));
    `,
  });
  await using proc = Bun.spawn({
    cmd: [bunExe(), ...Object.entries(define).flatMap(([key, value]) => ["--define", key + "=" + value]), "main.js"],
    env,
    cwd: String(dir),
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  const values = {
    object: { a: 1, b: [1, { c: "d" }] },
    item: "d",
    string: "hello world",
    number: 42,
    null: null,
    identifier: true,
    dotted: 8080,
    constant: "production",
  };
  expect(stderr).toBe("");
  expect(JSON.parse(stdout)).toEqual({ main: values, worker: values, nested: values });
  expect(exitCode).toBe(0);
});

// The lists of an object or an array value do not go into the arena of the Worker:
// https://github.com/oven-sh/bun/pull/44222
test.todo("a Worker frees an object define value that it parsed", async () => {
  const entries = Array.from({ length: 2000 }, (_, i) => ["key" + i, ["item" + i, i]]);
  await expectFreed(JSON.stringify(Object.fromEntries(entries)));
});
