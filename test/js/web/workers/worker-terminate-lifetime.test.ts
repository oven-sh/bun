import { expect, test } from "bun:test";
import { bunEnv, bunExe, isASAN, isDebug, tempDir } from "harness";
import { join } from "path";

// Worker VM startup/teardown is much slower under debug and/or ASAN; these
// tests spawn many workers, so scale iteration counts and timeouts down.
// ASAN catches the underlying UAF deterministically, so fewer iterations
// are still sufficient regression coverage.
const slow = isDebug || isASAN;
const rounds = slow ? 4 : 8;
const perRound = slow ? 12 : 32;
const timeout = slow ? 60_000 : 20_000;

// Regression: `new Worker(url, { ref: false })` was silently ignored — the
// Zig-side `user_keep_alive` field was set from it but never read, and the
// parent keep-alive was taken unconditionally in `create()`. `.unref()` after
// construction worked; the constructor option did not.
test("new Worker with { ref: false } does not keep the parent alive", async () => {
  await using proc = Bun.spawn({
    cmd: [
      bunExe(),
      "-e",
      `
        // The worker never exits on its own; if ref:false is honoured the
        // parent process exits immediately after spawning it.
        new Worker("data:text/javascript,setInterval(() => {}, 100000)", { ref: false });
        console.log("spawned");
      `,
    ],
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  expect(stderr).toBe("");
  expect(stdout).toBe("spawned\n");
  expect(exitCode).toBe(0);
});

// Regression: the Zig WebWorker struct was freed by the worker thread in
// exitAndDeinit while the C++ Worker still held a raw impl_ pointer, so a
// terminate()/ref()/unref() that landed after natural exit dereferenced freed
// memory (ASAN use-after-poison in setRefInternal).
test(
  "terminate/ref/unref after worker exits naturally does not UAF",
  async () => {
    await using proc = Bun.spawn({
      cmd: [
        bunExe(),
        "-e",
        `
        for (let round = 0; round < ${rounds}; round++) {
          const workers = [];
          for (let i = 0; i < ${perRound}; i++) {
            // Empty body: worker thread exits as soon as the event loop drains.
            workers.push(new Worker("data:text/javascript,"));
          }
          await Promise.all(workers.map(w => new Promise(r => w.addEventListener("close", r, { once: true }))));
          // All workers have exited; previously the Zig struct was freed here,
          // so every call below dereferenced freed memory via Worker::impl_.
          for (const w of workers) {
            w.ref();
            w.unref();
            w.terminate();
            w.terminate();
            w.ref();
            w.unref();
          }
        }
      `,
      ],
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });

    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect(stderr).toBe("");
    expect(stdout).toBe("");
    expect(exitCode).toBe(0);
  },
  timeout,
);

// Regression: WebWorker__dispatchExit deref'd the C++ Worker on the worker
// thread; if that was the last ref, ~Worker → ~EventTarget ran there and
// EventListenerMap::releaseAssertOrSetThreadUID tripped because the listener
// map was populated on the parent thread.
test(
  "nested worker whose grandchild outlives the middle worker's JSWorker does not assert",
  async () => {
    await using proc = Bun.spawn({
      cmd: [
        bunExe(),
        "-e",
        `
        for (let i = 0; i < ${rounds}; i++) {
          const middle = new Worker(
            'data:text/javascript,' +
            // Middle worker creates an inner worker, registers a listener (so the
            // inner Worker's EventListenerMap is tagged with the middle thread),
            // then lets its own event loop drain.
            'const w = new Worker("data:text/javascript,"); w.addEventListener("message", () => {});'
          );
          middle.addEventListener("message", () => {});
          await new Promise(r => middle.addEventListener("close", r, { once: true }));
        }
      `,
      ],
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });

    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect(stderr).toBe("");
    expect(stdout).toBe("");
    expect(exitCode).toBe(0);
  },
  timeout,
);

// Regression: the per-VM c-ares channel was destroyed in deinit_runtime_state
// (RuntimeState drop) AFTER JSC teardown and RareData.file_polls drop.
// ares_destroy() synchronously fires EDESTRUCTION query callbacks and socket-
// state callbacks, which then dereferenced the freed JSGlobalObject and the
// freed FilePoll hive. ASAN-only: release builds read freed memory without
// crashing. Upstream Node test-worker-dns-terminate.js.
test.skipIf(!isASAN)(
  "terminate() while dns.lookup() is in flight does not UAF on c-ares channel teardown",
  async () => {
    await using proc = Bun.spawn({
      cmd: [
        bunExe(),
        "-e",
        `
        const { Worker } = require("worker_threads");
        let done = 0;
        for (let i = 0; i < 4; i++) {
          const w = new Worker(
            // Hermetic: point the global resolver's c-ares channel at a local
            // UDP socket that never replies, so both queries are guaranteed
            // in-flight (socket registered, no completion) when terminate()
            // lands. dns.lookup() only respects setServers() where the c-ares
            // backend is the default (Linux); elsewhere resolve4 alone still
            // covers the socket-state and EDESTRUCTION paths hermetically.
            'const dgram = require("dgram");' +
            'const dns = require("dns");' +
            'const s = dgram.createSocket("udp4");' +
            's.bind(0, "127.0.0.1", () => {' +
            '  dns.setServers(["127.0.0.1:" + s.address().port]);' +
            '  if (process.platform === "linux") dns.lookup("example.org", () => {});' +
            '  dns.resolve4("example.org", () => {});' +
            '  require("worker_threads").parentPort.postMessage(0);' +
            '});',
            { eval: true },
          );
          w.on("message", () => w.terminate().then(() => {
            if (++done === 4) console.log("ok");
          }));
        }
      `,
      ],
      env: {
        ...bunEnv,
        ASAN_OPTIONS: [bunEnv.ASAN_OPTIONS, "detect_leaks=1"].filter(Boolean).join(":"),
        LSAN_OPTIONS: `print_suppressions=0:suppressions=${join(import.meta.dirname, "../../../leaksan.supp")}`,
      },
      stdout: "pipe",
      stderr: "pipe",
    });

    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect({ stdout, stderr, exitCode }).toEqual({ stdout: "ok\n", stderr: "", exitCode: 0 });
  },
  timeout,
);

// Regression: off-thread completions (WorkPool / HTTP thread / bundle thread)
// posted back to a worker's EventLoop via a raw BackRef<EventLoop>/&VirtualMachine
// captured at schedule time. worker.terminate() freed the VM box before the
// pool thread ran, so the enqueue dereferenced freed memory. Every cross-thread
// source is now posted by ScriptExecutionContextIdentifier under the contexts-
// map lock (serializing with markTerminating). ASAN-only: release builds read
// freed memory without crashing; under ASAN the heap-use-after-free is
// deterministic on the first teardown.
test.skipIf(!isASAN)(
  "terminate() while cross-thread WorkPool completions are in flight does not UAF on enqueue",
  async () => {
    // Worker body: arm one in-flight op per cross-thread source, signal the
    // parent, then sit. All loopback-only; results ignored.
    const body = `
      import { parentPort } from "node:worker_threads";
      import fs from "node:fs"; import fsp from "node:fs/promises";
      import zlib from "node:zlib"; import crypto from "node:crypto";
      import os from "node:os"; import path from "node:path";
      const sink = () => {}; const swallow = p => Promise.resolve(p).then(sink, sink);
      const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "wt-"));
      const tf = path.join(tmp, "a.txt");
      fs.writeFileSync(tf, Buffer.alloc(1 << 14, "x").toString());
      // WorkTask<ReadFile/WriteFile>
      swallow(Bun.write(path.join(tmp, "b.txt"), Buffer.alloc(1 << 14, "y").toString()));
      swallow(Bun.file(tf).text());
      // AsyncFSTask
      swallow(fsp.readFile(tf)); swallow(fsp.stat(tf));
      swallow(fsp.readdir(tmp, { recursive: true }));
      // AnyTaskJob (pbkdf2/scrypt/keygen/zstd)
      crypto.pbkdf2("p", "s", 50000, 64, "sha512", sink);
      crypto.scrypt("p", "saltsalt", 64, sink);
      crypto.generateKeyPair("rsa", { modulusLength: 1024 }, sink);
      swallow(Bun.zstdCompress(Buffer.alloc(1 << 14)));
      // PasswordJob
      swallow(Bun.password.hash("hunter2", { algorithm: "bcrypt", cost: 4 }));
      // CompressionStream async_job_run
      zlib.deflate(Buffer.alloc(1 << 16), sink); zlib.gzip(Buffer.alloc(1 << 16), sink);
      // ConcurrentPromiseTask<TransformTask/WalkTask>
      swallow(new Bun.Transpiler({ loader: "ts" }).transform("const x: number = 1;"));
      swallow(Array.fromAsync(new Bun.Glob("**/*").scan(tmp)));
      // ConcurrentCppTask (WebCrypto)
      swallow(crypto.subtle.digest("SHA-256", new Uint8Array(1 << 14)));
      // JSBundleCompletionTask
      const e = path.join(tmp, "e.ts"); fs.writeFileSync(e, "export const x=1;");
      swallow(Bun.build({ entrypoints: [e], target: "bun" }));
      // FetchTasklet (HTTP thread)
      const srv = Bun.serve({ port: 0, fetch: () => new Response(Buffer.alloc(1 << 12, "x")) });
      swallow(fetch("http://127.0.0.1:" + srv.port + "/").then(r => r.text()));
      parentPort.postMessage("armed");
      setInterval(sink, 1 << 30);
    `;
    using dir = tempDir("worker-terminate-crossthread", {
      "body.mjs": body,
      "main.mjs": `
        import { Worker } from "node:worker_threads";
        const n = ${slow ? 4 : 12};
        for (let i = 0; i < n; i++) {
          const w = new Worker(new URL("./body.mjs", import.meta.url));
          await new Promise((res, rej) => {
            w.once("message", res); w.once("error", rej);
          });
          await w.terminate();
        }
        console.log("ok");
      `,
    });
    await using proc = Bun.spawn({
      cmd: [bunExe(), "main.mjs"],
      env: bunEnv,
      cwd: String(dir),
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    // No UAF, no panic, no assert: stderr must be clean and the driver must
    // have finished every round.
    expect(stderr).toBe("");
    expect(stdout).toBe("ok\n");
    expect(exitCode).toBe(0);
  },
  timeout * 2,
);
