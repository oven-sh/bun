import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, isASAN, tempDir } from "harness";

// Worker spawn loops under a debug+ASAN build are slow (worker startup alone
// is ~2s); every test here is a rare, deliberate outlier.
const TIMEOUT = 90_000;

// Worker teardown must wait for every job the worker's VM handed to another
// thread (WorkPool bodies, webcrypto's phony work queue, the bundler thread)
// before freeing the VM box, its EventLoop, and the JSC heap. Each family
// below keeps lanes of one off-thread job type in flight while the worker is
// torn down at a jittered offset; on an unfixed build the pool thread's
// completion post (or its read of a JSC-heap-backed buffer) is a
// use-after-free that aborts the subprocess under ASAN.
//
// ASAN-gated: the dangling reads are small and release builds can survive
// them silently, so only the sanitizer build proves anything.
describe.skipIf(!isASAN)("worker teardown with off-thread jobs in flight does not UAF", () => {
  const ROUNDS = 3;

  // Each family body runs inside the worker. `lanes(n, f)` keeps n lanes of
  // the job type permanently in flight; `buf()` makes a JSC-heap-backed
  // buffer big enough that the off-thread body is still touching it when
  // teardown lands.
  const families: Record<string, string> = {
    "crypto.pbkdf2 (AnyTaskJob)": `
      const { pbkdf2 } = require("node:crypto");
      lanes(3, () => new Promise((res, rej) => pbkdf2("pw", "salt", 150000, 64, "sha512", e => e ? rej(e) : res())));`,
    "crypto.scrypt (AnyTaskJob)": `
      const { scrypt } = require("node:crypto");
      lanes(2, () => new Promise((res, rej) => scrypt("pw", "salt", 64, { N: 16384, r: 8, p: 1 }, e => e ? rej(e) : res())));`,
    "Bun.password.hash (PasswordJob)": `
      lanes(2, () => Bun.password.hash("hunter2", { algorithm: "argon2id", timeCost: 3, memoryCost: 8192 }));`,
    "Bun.zstdCompress (AnyTaskJob)": `
      const big = buf();
      lanes(2, () => Bun.zstdCompress(big));`,
    "Bun.Glob.scan (ConcurrentPromiseTask)": `
      lanes(2, async () => {
        const g = new Bun.Glob("**/*");
        for await (const _ of g.scan({ cwd: d.dir })) {}
      });`,
    "Bun.Transpiler.transform (ConcurrentPromiseTask)": `
      const t = new Bun.Transpiler({ loader: "tsx" });
      const src = 'export function C(){ return <div a={1+1}>{"x".repeat(3)}</div> }\\n'.repeat(1500);
      lanes(2, () => t.transform(src));`,
    "fs.promises read/write (AsyncFSTask)": `
      const fs = require("node:fs/promises");
      const big = Buffer.alloc(12 << 20, 0x61);
      lanes(2, async () => {
        await fs.writeFile(d.dir + "/blob.bin", big);
        await fs.readFile(d.dir + "/blob.bin");
      });`,
    "fs.promises.readdir recursive (AsyncReaddirRecursiveTask)": `
      const fs = require("node:fs/promises");
      lanes(2, () => fs.readdir(d.dir, { recursive: true }));`,
    "fs.promises.cp recursive (AsyncCpTask)": `
      const fs = require("node:fs/promises");
      let i = 0;
      lanes(2, () => fs.cp(d.dir + "/tree", d.dir + "/copy" + (i++ % 4), { recursive: true, force: true }));`,
    "Bun.$ shell builtins (ShellTask)": `
      let i = 0;
      lanes(2, async () => {
        const n = "sh" + (i++ % 4);
        await Bun.$\`mkdir -p \${n}/a/b && rm -rf \${n}\`.cwd(d.dir).quiet();
      });`,
    "crypto.subtle.digest (ConcurrentCppTask)": `
      const data = buf();
      lanes(3, () => crypto.subtle.digest("SHA-512", data));`,
    "Bun.build (JSBundleCompletionTask)": `
      lanes(1, () => Bun.build({ entrypoints: [d.dir + "/entry.ts"], target: "bun", write: false, logLevel: "silent" }).catch(() => {}));`,
    "Bun.Archive gzip bytes (ArchiveBlobTask)": `
      const chunk = Buffer.alloc(512 << 10); for (let i = 0; i < chunk.length; i += 7) chunk[i] = i & 0xff;
      const files = {}; for (let i = 0; i < 24; i++) files["ar" + (i % 4) + "/f" + i + ".bin"] = chunk;
      lanes(3, () => new Bun.Archive(files, { compress: "gzip", level: 6 }).bytes());`,
  };

  // Three teardown doors, all funneling into the same WebWorker::shutdown:
  // parent-side terminate(), in-worker process.exit(), in-worker uncaught
  // throw. The full door matrix runs for two representative families; the
  // rest use terminate(), the door that lands at the most hostile time.
  const doors: Record<string, { workerExit: string; parentAction: string }> = {
    "terminate()": { workerExit: "", parentAction: "await Bun.sleep(T); await w.terminate();" },
    "process.exit()": { workerExit: "setTimeout(() => process.exit(0), d.T);", parentAction: "" },
    "uncaught throw": { workerExit: "setTimeout(() => { throw new Error('boom'); }, d.T);", parentAction: "" },
  };
  const allDoorFamilies = new Set(["crypto.pbkdf2 (AnyTaskJob)", "fs.promises read/write (AsyncFSTask)"]);

  for (const [family, body] of Object.entries(families)) {
    for (const [door, { workerExit, parentAction }] of Object.entries(doors)) {
      if (door !== "terminate()" && !allDoorFamilies.has(family)) continue;
      test.concurrent(
        `${family}, ${door}`,
        async () => {
          using dir = tempDir("worker-offthread", {
            "entry.ts": `import { x } from "./dep.ts"; console.log(x);`,
            "dep.ts": `export const x: number = ${"1 + ".repeat(500)}1;`,
            "tree/a/one.txt": "one",
            "tree/a/b/two.txt": "two",
            "tree/a/b/c/three.txt": "three",
            "tree/four.txt": "four",
          });

          const script = /* js */ `
            const { Worker } = require("node:worker_threads");
            const src =
              'const { parentPort, workerData: d } = require("node:worker_threads");' +
              'const lanes = (n, f) => { for (let i = 0; i < n; i++) (async () => { for (;;) { try { await f(); } catch {} } })(); };' +
              'const buf = () => { const b = new Uint8Array(12 << 20); for (let i = 0; i < b.length; i += 4096) b[i] = i & 0xff; return b; };' +
              ${JSON.stringify(body.trim())} + ";" +
              'parentPort.postMessage("up");' +
              ${JSON.stringify(workerExit)};
            function ready(w) {
              return new Promise((res, rej) => {
                w.once("message", res);
                w.once("error", rej);
                w.once("exit", c => rej(new Error("worker exited " + c + " before ready")));
              });
            }
            (async () => {
              for (let r = 0; r < ${ROUNDS}; r++) {
                // Jittered teardown offset so some rounds land mid-compute and
                // some land with completions already queued.
                const T = 10 + ((r * 73) % 180);
                const w = new Worker(src, { eval: true, workerData: { dir: ${JSON.stringify(String(dir))}, T } });
                await ready(w);
                w.on("error", () => {});
                const exited = new Promise(res => w.once("exit", res));
                ${parentAction}
                await exited;
              }
              console.log("OK");
            })().catch(e => {
              console.error(String(e && (e.stack || e)));
              process.exit(1);
            });
          `;

          await using proc = Bun.spawn({
            cmd: [bunExe(), "-e", script],
            env: bunEnv,
            stdout: "pipe",
            stderr: "pipe",
          });
          const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
          // Any sanitizer report is the bug this file exists to catch.
          expect(stderr).not.toContain("AddressSanitizer");
          // Debug builds have a separate, pre-existing terminate() bug: the
          // TerminationException can materialize mid-dispatch and trip JSC's
          // ExceptionScope::assertNoException before teardown even starts
          // (reproduces on an unfixed-teardown build too, right after
          // notifyNeedTermination). Until that missing exception check is
          // fixed, a round that dies with exactly that assert is tolerated;
          // everything else must run all rounds cleanly.
          if (!stderr.includes("assertNoException")) {
            expect(stderr).toBe("");
            expect(stdout).toBe("OK\n");
            expect(exitCode).toBe(0);
          }
        },
        TIMEOUT,
      );
    }
  }
});

// FetchTasklet holds a lifetime-erased &'static VirtualMachine and the shared
// HTTP client thread reads it (is_shutting_down / enqueue_task_concurrent)
// after WebWorker::shutdown dealloc'd the worker's VM storage, taking the
// whole process down (SIGSEGV on release, ASAN heap-use-after-free on debug).
// All four shutdown doors funnel through the same WebWorker::shutdown, so the
// fence is door-agnostic; the test matrix proves it. ASAN-gated: the read is
// one byte from freed memory, which release builds can survive.
describe.skipIf(!isASAN)(
  "worker shutdown with fetch() in flight does not read the freed worker VM from the HTTP thread",
  () => {
    const ROUNDS = 8;
    // workerExit is inlined into the worker body; parentAction replaces
    // terminate() when the worker ends itself.
    const doors: { door: string; workerExit: string; parentAction: string }[] = [
      { door: "terminate()", workerExit: "", parentAction: "await w.terminate();" },
      { door: "process.exit()", workerExit: "setTimeout(() => process.exit(0), d.T);", parentAction: "" },
      { door: "uncaught throw", workerExit: "setTimeout(() => { throw new Error('boom'); }, d.T);", parentAction: "" },
      {
        door: "unhandled rejection",
        workerExit: "setTimeout(() => Promise.reject(new Error('boom')), d.T);",
        parentAction: "",
      },
    ];
    for (const { door, workerExit, parentAction } of doors) {
      test.concurrent(
        door,
        async () => {
          await using proc = Bun.spawn({
            cmd: [
              bunExe(),
              "-e",
              `
              const { Worker } = require("node:worker_threads");
              const server = Bun.serve({
                hostname: "127.0.0.1",
                port: 0,
                fetch(req) {
                  if (new URL(req.url).pathname === "/health") return new Response("ok");
                  // Long trickle so HTTP-thread callbacks for this request keep
                  // arriving past the worker's VM dealloc.
                  const enc = new TextEncoder();
                  return new Response(new ReadableStream({ async start(c) {
                    for (let i = 0; i < 200; i++) { c.enqueue(enc.encode("chunk" + i + "\\n")); await Bun.sleep(2); }
                    c.close();
                  } }));
                },
              });
              const base = "http://127.0.0.1:" + server.port;
              // 10 lanes of back-to-back fetches, mixed body consumption: half
              // buffer the whole body, half read one chunk and release the
              // reader so the stream is still draining when the worker exits.
              const src =
                'const { parentPort, workerData: d } = require("node:worker_threads");' +
                'async function lane(l) { for (let i = 0; ; i++) { try {' +
                '  const r = await fetch(d.base + "/slow?l=" + l + "&i=" + i);' +
                '  if (i & 1) { const rd = r.body.getReader(); await rd.read(); rd.releaseLock(); }' +
                '  else await r.arrayBuffer(); } catch {} } }' +
                'for (let l = 0; l < 10; l++) lane(l);' +
                'parentPort.postMessage("up");' +
                ${JSON.stringify(workerExit)};
              function ready(w) {
                return new Promise((res, rej) => {
                  w.once("message", res);
                  w.once("error", rej);
                  w.once("exit", c => rej(new Error("worker exited " + c + " before ready")));
                });
              }
              for (let r = 0; r < ${ROUNDS}; r++) {
                const T = 60 + ((r * 37) % 200);
                const w = new Worker(src, { eval: true, workerData: { base, T } });
                await ready(w);
                w.on("error", () => {});
                const exited = new Promise(res => w.once("exit", res));
                ${parentAction ? `await Bun.sleep(T); ${parentAction}` : ""}
                await exited;
                // Keep-alive pool must stay healthy across the shutdown.
                const t = await fetch(base + "/health").then(x => x.text());
                if (t !== "ok") throw new Error("pool unhealthy after round " + r);
              }
              server.stop(true);
              console.log("survived");
            `,
            ],
            env: bunEnv,
            stdout: "pipe",
            stderr: "pipe",
          });

          const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
          // Any sanitizer report is the bug this block exists to catch.
          expect(stderr).not.toContain("AddressSanitizer");
          // Same pre-existing mid-dispatch assertNoException tolerance as the
          // family matrix above.
          if (!stderr.includes("assertNoException")) {
            expect(stderr).toBe("");
            expect(stdout).toBe("survived\n");
            expect(exitCode).toBe(0);
          }
        },
        TIMEOUT,
      );
    }
  },
);
