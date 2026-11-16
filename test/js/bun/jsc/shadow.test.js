import { describe, expect, it } from "bun:test";
import { bunEnv, bunExe, isASAN, isDebug } from "harness";

it("shadow realm works", () => {
  const red = new ShadowRealm();
  globalThis.someValue = 1;
  // Affects only the ShadowRealm's global
  const result = red.evaluate("globalThis.someValue = 2;");
  expect(globalThis.someValue).toBe(1);
  expect(result).toBe(2);
});

it("process.nextTick() runs its callback, before the promise jobs", async () => {
  const order = [];
  const schedule = new ShadowRealm().evaluate(`log => {
    Promise.resolve().then(() => log("job"));
    process.nextTick((a, b) => log("tick " + a + b), 1, 2);
  }`);
  schedule(entry => void order.push(entry));
  await new Promise(resolve => setImmediate(resolve));
  expect(order).toEqual(["tick 12", "job"]);
});

it("process.nextTick() throws the realm's own TypeError for a non-function", () => {
  const thrown = new ShadowRealm().evaluate(`
    try {
      process.nextTick(1);
    } catch (error) {
      [error instanceof TypeError, error.code].join();
    }`);
  expect(thrown).toBe("true,ERR_INVALID_ARG_TYPE");
});

async function run(script) {
  await using proc = Bun.spawn({ cmd: [bunExe(), "-e", script], env: bunEnv, stdout: "pipe", stderr: "pipe" });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  return { stdout, stderr, exitCode };
}

it.concurrent("an error thrown by a process.nextTick() callback is uncaught", async () => {
  expect(
    await run(`
      process.on("uncaughtException", error => console.log("uncaughtException:", error.message));
      new ShadowRealm().evaluate('process.nextTick(() => { throw new Error("from the realm"); })');`),
  ).toEqual({ stdout: "uncaughtException: from the realm\n", stderr: "", exitCode: 0 });
});

it.concurrent("an unhandled rejection reaches process.on('unhandledRejection')", async () => {
  expect(
    await run(`
      process.on("unhandledRejection", reason => console.log("unhandledRejection:", reason.message));
      new ShadowRealm().evaluate('Promise.reject(new Error("from the realm")); 0');`),
  ).toEqual({ stdout: "unhandledRejection: from the realm\n", stderr: "", exitCode: 0 });
});

it.concurrent("an unhandled rejection ends the process", async () => {
  const { stdout, stderr, exitCode } = await run(`
    new ShadowRealm().evaluate('Promise.reject(new Error("from the realm")); 0');
    setTimeout(() => console.log("still running"), 0);`);
  expect(stderr).toContain("error: from the realm");
  expect({ stdout, exitCode }).toEqual({ stdout: "", exitCode: 1 });
});

it.concurrent("rejected promises are collected", async () => {
  expect(
    await run(`
      const { heapStats } = require("bun:jsc");
      const promises = () => (Bun.gc(true), heapStats().objectTypeCounts.Promise ?? 0);
      process.on("unhandledRejection", () => {});
      const reject = new ShadowRealm().evaluate("() => { for (let i = 0; i < 1000; i++) Promise.reject(i); }");
      setImmediate(() => {
        const before = promises();
        reject();
        // One or two stay, in the main realm too, however many there were.
        setImmediate(() => console.log(promises() - before < 10));
      });`),
  ).toEqual({ stdout: "true\n", stderr: "", exitCode: 0 });
});

describe.concurrent("an unreachable ShadowRealm", () => {
  // JSC never frees the memory of the first 8 global objects of a VM, so ASAN needs more than that.
  const prelude = `
    const REALMS = 20;
    const runInRealms = (source, ...args) => {
      const functions = Array.from({ length: REALMS }, () => new ShadowRealm().evaluate(source));
      for (const f of functions) f(...args);
      return functions;
    };
    const onceForEachRealm = () => {
      const { promise, resolve } = Promise.withResolvers();
      let calls = 0;
      return { promise, call: () => void (++calls === REALMS && resolve()) };
    };
    const gcUntil = async condition => {
      const deadline = performance.now() + ${isDebug || isASAN ? 20_000 : 4_000};
      while ((Bun.gc(true), !condition())) {
        if (performance.now() > deadline) throw new Error("timed out: " + condition);
        await new Promise(resolve => setImmediate(resolve));
      }
    };
    const mostRealmsAreCollected = () => require("bun:jsc").heapStats().objectTypeCounts.GlobalObject < REALMS / 2;`;
  const fetchThen = then => `(url, done) => void fetch(url).then(response => done(void (${then})))`;
  const s3Stream = `(endpoint, done) => {
    const options = { endpoint, bucket: "bucket", accessKeyId: "id", secretAccessKey: "secret" };
    globalThis.kept = Bun.S3Client.file("key", options).stream();
    done();
  }`;

  it.each([
    ["a fetch() Response that it dropped", fetchThen("response")],
    ["a fetch() Response on globalThis", fetchThen("globalThis.kept = response")],
    ["a fetch() Response.body on globalThis", fetchThen("globalThis.kept = response.body")],
    ["an S3File.stream() on globalThis", s3Stream],
  ])("is collected, and its request is aborted, when it has not read %s", async (_, source) => {
    expect(
      await run(`${prelude}
        const [requested, started] = [onceForEachRealm(), onceForEachRealm()];
        let aborted = 0;
        const server = Bun.serve({
          port: 0,
          idleTimeout: 0,
          fetch(request) {
            request.signal.onabort = () => aborted++;
            requested.call();
            return new Response(new ReadableStream({ start: controller => controller.enqueue(new Uint8Array(1 << 20)) }));
          },
        });
        const functions = runInRealms(${JSON.stringify(source)}, server.url.href, started.call);
        await Promise.all([requested.promise, started.promise]);
        functions.length = 0;
        await gcUntil(mostRealmsAreCollected);
        await gcUntil(() => aborted > REALMS / 2);
        await server.stop(true);
        console.log("done");`),
    ).toEqual({ stdout: "done\n", stderr: "", exitCode: 0 });
  });

  it.each([
    ["a fetch() Response.body", fetchThen("globalThis.kept = response.body")],
    ["an S3File.stream()", s3Stream],
  ])("does not crash when the connection of %s closes after a GC", async (_, source) => {
    expect(
      await run(`${prelude}
        const [requested, started] = [onceForEachRealm(), onceForEachRealm()];
        const server = Bun.listen({
          hostname: "127.0.0.1",
          port: 0,
          socket: {
            data(socket) {
              if (socket.data) return;
              socket.data = true;
              socket.write("HTTP/1.1 200 OK\\r\\nContent-Length: 2\\r\\n\\r\\nx");
              requested.call();
            },
          },
        });
        const functions = runInRealms(${JSON.stringify(source)}, "http://127.0.0.1:" + server.port, started.call);
        await Promise.all([requested.promise, started.promise]);
        functions.length = 0;
        server.stop(true);
        // Unlike Bun.gc(true), a GC triggered by allocation runs no finalizer yet, and reuses the dead structures.
        for (let round = 0, keep; round < 20; round++) {
          keep = [new Uint8Array(1 << 23)];
          for (let i = 0; i < 100; i++) keep.push(class extends Error {}, Object.create({ i }));
        }
        process.on("beforeExit", () => {
          Bun.gc(true);
          console.log("done");
        });`),
    ).toEqual({ stdout: "done\n", stderr: "", exitCode: 0 });
  });
});

it("Bun.isMainThread and node:worker_threads' isMainThread reflect the realm's thread", async () => {
  expect(new ShadowRealm().evaluate("Bun.isMainThread")).toBe(true);
  expect(await new ShadowRealm().importValue("node:worker_threads", "isMainThread")).toBe(true);

  const url = URL.createObjectURL(new Blob([`postMessage(new ShadowRealm().evaluate("Bun.isMainThread"));`]));
  const worker = new Worker(url);
  try {
    const { promise, resolve, reject } = Promise.withResolvers();
    worker.onmessage = event => resolve(event.data);
    worker.onerror = reject;
    expect(await promise).toBe(false);
  } finally {
    worker.terminate();
    URL.revokeObjectURL(url);
  }
});
