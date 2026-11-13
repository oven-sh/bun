// A worker VM is destroyed only after everything it sent to another thread has
// come back (src/jsc/VmHandle.rs): work out on the thread pool / HTTP thread /
// bundle thread holds a *ticket* on the VM, and the worker's teardown waits
// for every ticket — releasing whatever arrives meanwhile on its own thread,
// heap alive — before the JSC VM goes. Something that merely refers to the
// worker from elsewhere (another thread's MessagePort, the child-process
// waiter thread) holds no ticket; its post is delivered-and-released while the
// worker drains, or refused once it has closed, and it frees its own payload.
//
// Here each of those paths runs deterministically for one producer at a time:
// with BUN_DEBUG_TEST_WORKER_TEARDOWN_GATE=draining the other thread's post is
// held until the worker's teardown is already waiting, so it always lands
// *during* the wait, and the runtime names it on stderr. With =closed a weak
// post is held until the wait has ended instead, so it is always refused. A row
// passes only if the named line appeared (the work really was on another
// thread, really came back at that stage, and — for ticketed work — was taken
// through the door at the expected site) and the process exited cleanly; on
// the ASAN build the release paths are also checked for use-after-free and
// leaks. Builds with debug assertions only (debug, ASAN): the gate does not
// exist in release.
import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, isAndroid, isASAN, isDebug, isLinux, isMacOS, isWindows, tempDir } from "harness";
import { mkfifo } from "mkfifo";
import fs from "node:fs";
import path from "node:path";
import type { ReadableStreamDefaultReader } from "node:stream/web";

type Row = {
  name: string;
  // Runs in the worker before it exits; starts exactly one piece of off-thread work.
  worker: string;
  // Runs in the parent before the worker is created; may add to `data` (workerData).
  prelude?: string;
  // Runs in the parent once the worker says it is set up (for producers on the parent's side).
  parent?: string;
  // Runs in the parent when the worker has exited (release what the prelude holds).
  onExit?: string;
  env?: Record<string, string>;
  files?: Record<string, string>;
  skip?: boolean;
} & (Ticketed | Weak);
// Ticketed work: substring of the site (file) the ticket was taken at, as
// logged by "[vm] late completion from <file>:<line>".
type Ticketed = { ticket: string; weak?: never; underTicket?: never };
// Weak posters: the task tag logged by "[vm] weak post at the gate: <tag>" when
// the post reaches the gate and by "[vm] late post: <tag> (<outcome>)" when it
// is made. Each runs under both gates: released by the wait under `draining`,
// refused under `closed`. The gate does not hold a post past the start of the
// wait while a ticket is outstanding, because the wait may be for that very
// poster: such a row (`underTicket`) is released under both.
type Weak = { weak: string; underTicket?: true; ticket?: never };

const RELEASED = "released by the wait";
const REFUSED = "refused";

const ROWS: Row[] = [
  // ── thread pool: bun_jsc::Job ────────────────────────────────────────────
  { name: "fs.readFile", worker: `require("node:fs").readFile(process.execPath, () => {});`, ticket: "node_fs.rs" },
  { name: "fs.promises.stat", worker: `require("node:fs").promises.stat(process.execPath);`, ticket: "node_fs.rs" },
  { name: "fs.realpath", worker: `require("node:fs").realpath(process.execPath, () => {});`, ticket: "node_fs.rs" },
  {
    // The pool thread reads the JS buffer's bytes in place.
    name: "fs.writeFile from a Buffer",
    worker: `require("node:fs").writeFile(require("node:path").join(workerData.dir, "out.bin"), Buffer.alloc(1 << 20, 7), () => {});`,
    ticket: "node_fs.rs",
    files: {},
  },
  {
    // The pool thread writes into the JS buffer's bytes in place.
    name: "fs.read into a Buffer",
    worker: `const fs = require("node:fs"); fs.read(fs.openSync(process.execPath, "r"), Buffer.alloc(1 << 20), 0, 1 << 20, 0, () => {});`,
    ticket: "node_fs.rs",
  },
  { name: "Bun.file().text()", worker: `Bun.file(process.execPath).slice(0, 65536).text();`, ticket: "read_file.rs" },
  {
    // Same read job, different completion: the image's read chain is handed
    // ECANCELED at teardown and has to free itself.
    name: "Bun.Image(Bun.file()).metadata()",
    worker: `new Bun.Image(Bun.file(process.execPath).slice(0, 65536)).metadata().catch(() => {});`,
    ticket: "read_file.rs",
  },
  {
    name: "crypto.pbkdf2",
    worker: `require("node:crypto").pbkdf2("p", "s", 1000, 32, "sha256", () => {});`,
    ticket: "PBKDF2.rs",
  },
  {
    name: "crypto.scrypt",
    worker: `require("node:crypto").scrypt("p", "s", 32, () => {});`,
    ticket: "node_crypto_binding.rs",
  },
  {
    name: "crypto.randomFill",
    worker: `require("node:crypto").randomFill(Buffer.alloc(65536), () => {});`,
    ticket: "node_crypto_binding.rs",
  },
  {
    name: "crypto.generateKeyPair",
    worker: `require("node:crypto").generateKeyPair("ec", { namedCurve: "P-256" }, () => {});`,
    ticket: "node_crypto_binding.rs",
  },
  {
    // WebCrypto's work queue: a C++ closure on the pool, carried (with a
    // ticket) by ConcurrentCppTask; its *result* comes back by context id —
    // WebCore's postTaskTo(), a weak post — and because the ticket kept the
    // worker draining rather than closed, that post is delivered and its
    // promise/callback refs are released on the worker's thread.
    name: "crypto.subtle.digest",
    worker: `crypto.subtle.digest("SHA-256", Buffer.alloc(65536));`,
    weak: "CppTask",
    underTicket: true,
  },
  {
    name: "Bun.password.hash",
    worker: `Bun.password.hash("x", { algorithm: "bcrypt", cost: 4 });`,
    ticket: "PasswordObject.rs",
  },
  {
    name: "Bun.Glob scan",
    worker: `new Bun.Glob("**/*").scan({ cwd: workerData.dir })[Symbol.asyncIterator]().next();`,
    ticket: "glob.rs",
    files: { "a/b/c/d.txt": "x", "a/e.txt": "y", "f/g/h.txt": "z" },
  },
  {
    name: "dns lookup on the thread pool",
    worker: `Bun.dns.lookup("localhost", { backend: "libc" });`,
    ticket: "dns.rs",
  },
  {
    name: "Bun.Transpiler.transform",
    worker: `new Bun.Transpiler().transform("export const a: number = 1");`,
    ticket: "JSTranspiler.rs",
  },
  {
    name: "CompressionStream",
    worker: `new Response(new Blob([Buffer.alloc(1 << 20, 9)]).stream().pipeThrough(new CompressionStream("gzip"))).arrayBuffer();`,
    ticket: "CompressionStreamCoder.rs",
  },
  {
    // A Job whose subtasks fan out across the pool and finish it from whichever ends last.
    name: "fs.promises.readdir recursive",
    worker: `require("node:fs").promises.readdir(workerData.dir, { recursive: true });`,
    ticket: "node_fs.rs",
    files: { "a/b/c/d.txt": "x", "a/e.txt": "y", "f/g/h.txt": "z" },
  },
  {
    // The completion is posted by the last of the copy's pool subtasks.
    name: "fs.cp recursive",
    worker: `require("node:fs").cp(require("node:path").join(workerData.dir, "src"), require("node:path").join(workerData.dir, "dst"), { recursive: true }, () => {});`,
    ticket: "node_fs.rs",
    files: { "src/a/b/c.txt": "x", "src/d.txt": "y", "src/e/f.txt": "z" },
  },
  // ── thread pool: Bun.$ builtins (interpreter state a JS wrapper owns) ────
  {
    // Subtasks created on the pool inherit the parent's ticket (new_child).
    name: "$ ls -R",
    worker: `Bun.$\`ls -R \${workerData.dir}\`.quiet().catch(() => {});`,
    ticket: "interpreter.rs",
    files: { "a/b/c/d.txt": "x", "a/e.txt": "y", "f/g/h.txt": "z" },
  },
  {
    // The builtin's pool task hands the copy to an fs.cp task carrying a
    // clone of its poster; that task's last subtask posts the completion.
    name: "$ cp -R",
    worker: `Bun.$\`cp -R \${workerData.dir}/src \${workerData.dir}/dst\`.quiet().catch(() => {});`,
    ticket: "cp.rs",
    files: { "src/a/b/c.txt": "x", "src/d.txt": "y", "src/e/f.txt": "z" },
    // The cp builtin is Windows-only unless opted into (POSIX spawns cp(1)).
    env: { BUN_ENABLE_EXPERIMENTAL_SHELL_BUILTINS: "1" },
  },
  {
    name: "$ rm -rf",
    worker: `Bun.$\`rm -rfv \${workerData.dir}/gone\`.quiet().catch(() => {});`,
    ticket: "rm.rs",
    files: { "gone/a/b/c.txt": "x", "gone/d.txt": "y", "gone/e/f/g.txt": "z" },
  },
  // ── thread pool: storage inside a JS-owned object ────────────────────────
  {
    // The zlib stream's native part is the pool task; input/output are JS buffers.
    name: "zlib.gzip",
    worker: `require("node:zlib").gzip(Buffer.alloc(1 << 20, 3), () => {});`,
    ticket: "node_zlib_binding.rs",
  },
  {
    // The transpile job is a slot inside the VM itself.
    name: "import() of a TypeScript module",
    worker: `import(require("node:path").join(workerData.dir, "mod.ts"));`,
    ticket: "RuntimeTranspilerStore.rs",
    files: { "mod.ts": `export const x: number = ${Date.now()};\n` },
  },
  // ── HTTP thread ──────────────────────────────────────────────────────────
  {
    // Parked on a peer that never answers: the stop phase aborts it and the
    // HTTP thread hands it back during the wait.
    name: "fetch in flight",
    prelude: `const server = Bun.serve({ port: 0, fetch: () => new Promise(() => {}) }); data.url = server.url.href;`,
    worker: `fetch(workerData.url).catch(() => {});`,
    onExit: `server.stop(true);`,
    ticket: "FetchTasklet.rs",
  },
  // ── bundle thread ────────────────────────────────────────────────────────
  {
    name: "Bun.build",
    worker: `Bun.build({ entrypoints: [require("node:path").join(workerData.dir, "entry.ts")] });`,
    ticket: "js_bundle_completion_task.rs",
    files: { "entry.ts": `export default 1;\n` },
  },
  // ── weak posters (no ticket): delivered while draining, or refused ───────
  {
    name: "child exit reported by the waiter thread",
    worker: `require("node:child_process").execFile(process.execPath, ["-e", "0"], () => {});`,
    weak: "ProcessWaiterThreadTask",
    // The waiter thread is a POSIX fallback path, opted into here the way the runtime's own tests do.
    env: { BUN_GARBAGE_COLLECTOR_LEVEL: "0", BUN_FEATURE_FLAG_FORCE_WAITER_THREAD: "1" },
    // The flag is honoured on Linux/Android only (kqueue platforms always have EVFILT_PROC).
    skip: !isLinux && !isAndroid,
  },
  {
    // JSC compiles on a helper thread, which hands the result to the VM as deferred work.
    name: "WebAssembly.compile",
    worker: `WebAssembly.compile(new Uint8Array([0, 97, 115, 109, 1, 0, 0, 0]));`,
    weak: "JSCDeferredWorkTask",
  },
  {
    name: "BroadcastChannel message from another thread",
    worker: `const bc = new BroadcastChannel("wlc"); bc.onmessage = () => {};`,
    // An open channel keeps the parent's loop alive (as in Node); close it once posted.
    parent: `const pc = new BroadcastChannel("wlc"); pc.postMessage("late"); pc.close();`,
    weak: "CppTask",
  },
  {
    name: "MessagePort message from another thread",
    worker: `workerData.port.on("message", () => {});`,
    parent: `port1.postMessage("late");`,
    weak: "CppTask",
  },
];

// The host: one worker, armed gate. The worker starts its work, reports
// "armed" and exits by itself two turns later; the parent never posts anything
// the worker waits for (with the gate armed, a parent→worker post is itself a
// cross-thread post that waits for the worker's teardown). Rows with a parent
// side post in response to "armed".
//
// Nothing makes a worker wait for a weak post, and C++ stops posting to a
// context whose teardown has begun. So a weak row's worker stays in a read of
// the host's stdin instead, and the test closes that stdin once the gate has
// reported the row's post.
//
// The worker's stdout and stderr are captured and left unread: piped through,
// the parent's end asks for data with a message on the stream's port, which is
// one more weak post to the worker than the row is about.
function host(row: Row, dir: string) {
  const worker = `
    const { parentPort, workerData } = require("node:worker_threads");
    parentPort.on("message", () => {});
    ${row.worker}
    parentPort.postMessage("armed");
    ${
      row.weak
        ? `require("node:fs").readSync(0, Buffer.alloc(1)); process.exit(0);`
        : `setImmediate(() => setImmediate(() => process.exit(0)));`
    }
  `;
  return `
    const { Worker, MessageChannel } = require("node:worker_threads");
    const { port1, port2 } = new MessageChannel();
    const data = { port: port2, dir: ${JSON.stringify(dir)} };
    ${row.prelude ?? ""}
    const w = new Worker(${JSON.stringify(worker)}, { eval: true, workerData: data, transferList: [port2], stdout: true, stderr: true });
    w.on("error", e => { console.error("worker error:", e && e.message); process.exitCode = 1; });
    w.once("message", () => { ${row.parent ? `console.error("[row] posting"); ${row.parent}` : ""} });
    w.on("exit", code => { port1.close(); ${row.onExit ?? ""} if (code !== 0) { console.error("worker exit code", code); process.exitCode = 1; } });
  `;
}

// Runs the row's host under `gate` and returns what it printed. A weak row's
// host is released (its stdin closed) when the gate reports the row's post.
async function runHost(row: Row, gate: "draining" | "closed") {
  using dir = tempDir("worker-late-completion", row.files ?? {});
  await using proc = Bun.spawn({
    cmd: [bunExe(), "-e", host(row, String(dir))],
    env: { ...bunEnv, ...row.env, BUN_DEBUG_TEST_WORKER_TEARDOWN_GATE: gate },
    stdin: "pipe",
    stdout: "pipe",
    stderr: "pipe",
  });
  const readStderr = async () => {
    const decoder = new TextDecoder();
    let text = "";
    let held = !!row.weak;
    for await (const chunk of proc.stderr) {
      text += decoder.decode(chunk, { stream: true });
      if (held && text.includes(`[vm] weak post at the gate: ${row.weak}\n`)) {
        held = false;
        proc.stdin.end();
      }
    }
    return text;
  };
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), readStderr(), proc.exited]);
  return { stdout, stderr, exitCode };
}

describe.skipIf(!isDebug && !isASAN)("work that comes back after its worker began tearing down", () => {
  for (const row of ROWS) {
    if (row.ticket) {
      const ticket = row.ticket;
      test.concurrent.skipIf(!!row.skip)(row.name, async () => {
        const { stdout, stderr, exitCode } = await runHost(row, "draining");
        const seen = stderr.split("\n").some(l => l.startsWith("[vm] late completion from ") && l.includes(ticket));
        expect({
          exitCode,
          seen,
          // On a failure, everything the host printed.
          detail: exitCode === 0 && seen ? "" : stdout + stderr,
        }).toEqual({ exitCode: 0, seen: true, detail: "" });
      });
      continue;
    }
    for (const gate of ["draining", "closed"] as const) {
      const outcome = gate === "draining" || row.underTicket ? RELEASED : REFUSED;
      // Exactly the row's own post, in order: asked for, at the gate, made.
      const expected = [
        ...(row.parent ? ["[row] posting"] : []),
        `[vm] weak post at the gate: ${row.weak}`,
        `[vm] late post: ${row.weak} (${outcome})`,
      ];
      test.concurrent.skipIf(!!row.skip)(`${row.name} (${gate} gate: ${outcome})`, async () => {
        const { stdout, stderr, exitCode } = await runHost(row, gate);
        const posts = stderr
          .split("\n")
          .filter(
            l =>
              l === "[row] posting" || l.startsWith("[vm] weak post at the gate: ") || l.startsWith("[vm] late post: "),
          );
        expect({
          exitCode,
          posts,
          // On a failure, everything the host printed.
          detail: exitCode === 0 && Bun.deepEquals(posts, expected) ? "" : stdout + stderr,
        }).toEqual({ exitCode: 0, posts: expected, detail: "" });
      });
    }
  }
});

// A mode the gate does not know (main's old "1", a typo) must not read as "off":
// a row would then run ungated and fail with nothing that names the variable.
// The Worker constructor throws, so the process exits through its normal path
// (the VM is torn down, which LeakSanitizer needs).
test.concurrent.skipIf(!isDebug && !isASAN)("a gate mode that does not exist is refused by name", async () => {
  await using proc = Bun.spawn({
    cmd: [
      bunExe(),
      "-e",
      `try { new (require("node:worker_threads").Worker)("", { eval: true }); } catch (e) { console.log(e.constructor.name + ": " + e.message); }`,
    ],
    env: { ...bunEnv, BUN_DEBUG_TEST_WORKER_TEARDOWN_GATE: "1" },
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  expect({ stdout, stderr, exitCode }).toEqual({
    stdout: "TypeError: BUN_DEBUG_TEST_WORKER_TEARDOWN_GATE=1: the modes are draining and closed\n",
    stderr: "",
    exitCode: 0,
  });
});

const cc = isWindows ? null : process.env.CC || Bun.which("cc") || Bun.which("gcc") || Bun.which("clang");
test.concurrent.skipIf(!cc)("napi_queue_async_work fails in a finalizer during a worker's final GC", async () => {
  using dir = tempDir("worker-late-napi", {});
  const addon = path.join(String(dir), "addon.node");
  await using build = Bun.spawn({
    cmd: [
      cc!,
      "-shared",
      "-fPIC",
      ...(isMacOS ? ["-undefined", "dynamic_lookup"] : []),
      `-I${path.resolve(import.meta.dir, "../../../../src/runtime/napi")}`,
      path.join(import.meta.dir, "worker-late-completion-napi-fixture.c"),
      "-o",
      addon,
    ],
    env: bunEnv,
    stderr: "inherit",
  });
  expect(await build.exited).toBe(0);
  // The worker keeps the external reachable, so it's only finalized when the worker's heap is destroyed.
  await using proc = Bun.spawn({
    cmd: [
      bunExe(),
      "-e",
      `new (require("node:worker_threads").Worker)(
        "globalThis.keep = require(" + JSON.stringify(process.argv[1]) + ").queueFromFinalizer();",
        { eval: true },
      );`,
      addon,
    ],
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  // 23 is napi_cannot_run_js.
  expect({ stdout, stderr, exitCode }).toEqual({ stdout: "queued from finalizer: 23\n", stderr: "", exitCode: 0 });
});

// A `Bun.file()` / `Bun.stdin` read of a pipe or tty that has no data yet
// parks on the io loop instead of blocking a pool thread, so terminate() can
// and does cancel it: the worker goes away promptly and the read never settles.
describe.skipIf(isWindows)("terminate() cancels a read parked on the io loop", () => {
  test.concurrent.each([
    ["Bun.stdin.text()", [`Bun.stdin.text()`]],
    ["Bun.file(fifo).text()", [`Bun.file(workerData).text()`]],
    ["Bun.file(fifo).bytes() twice", [`Bun.file(workerData).bytes()`, `Bun.file(workerData).bytes()`]],
  ])("%s", async (_, reads) => {
    const worker = `
      const { parentPort, workerData } = require("node:worker_threads");
      const settled = w => v => parentPort.postMessage(w);
      for (const p of [${reads.join(",")}]) p.then(settled("resolved"), settled("rejected"));
      parentPort.postMessage("reading");
    `;
    using dir = tempDir("worker-terminate-cancels", {});
    const fifo = path.join(String(dir), "fifo");
    await using proc = Bun.spawn({
      cmd: [
        bunExe(),
        "-e",
        `
        const { Worker } = require("node:worker_threads");
        const { execFileSync } = require("node:child_process");
        const fifo = ${JSON.stringify(fifo)};
        execFileSync("mkfifo", [fifo]);
        // Hold the FIFO open read-write (does not block, unlike a write-only
        // open) so the worker's open() succeeds and its read parks waiting for
        // data that never comes.
        const writer = require("node:fs").openSync(fifo, "r+");
        const w = new Worker(${JSON.stringify(worker)}, { eval: true, workerData: fifo });
        const seen = [];
        w.on("message", async m => {
          seen.push(m);
          if (m !== "reading") return;
          const code = await w.terminate();
          console.log(JSON.stringify({ code, seen }));
          require("node:fs").closeSync(writer);
        });
      `,
      ],
      env: bunEnv,
      // The parent's stdin is the worker's Bun.stdin: a pipe nobody writes to.
      stdin: "pipe",
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect({ stdout: stdout.trim(), stderr: stderr.trim() }).toEqual({
      stdout: JSON.stringify({ code: 1, seen: ["reading"] }),
      stderr: "",
    });
    expect(exitCode).toBe(0);
  });
});

// The wait is unbounded by design: a job that cannot be cancelled makes
// terminate() take as long as the job (as Node's environment cleanup does),
// and then complete cleanly. Here the job is a read() blocking a pool thread on
// a FIFO nobody has written to yet (node:fs reads that way), so its duration is
// entirely the test's to decide — no timing thresholds. Debug builds also name
// what the wait is waiting for.
describe.skipIf(isWindows)("terminate() waits for work that cannot be cancelled", () => {
  test("a pool thread parked in read() holds the worker's teardown until it returns", async () => {
    using dir = tempDir("worker-terminate-waits", {});
    const fifo = path.join(String(dir), "fifo");
    await using proc = Bun.spawn({
      cmd: [
        bunExe(),
        "-e",
        `
        const { Worker } = require("node:worker_threads");
        const { execFileSync } = require("node:child_process");
        const fifo = ${JSON.stringify(fifo)};
        execFileSync("mkfifo", [fifo]);
        const w = new Worker(
          'require("node:fs").readFile(require("node:worker_threads").workerData, () => {});' +
          'require("node:worker_threads").parentPort.postMessage("reading");',
          // Captured stdio, as in host() above: the parent must not park at the gate before it terminates.
          { eval: true, workerData: fifo, stdout: true, stderr: true },
        );
        w.on("error", e => { console.error("worker error:", e); process.exitCode = 1; });
        w.once("message", () => {
          w.terminate().then(code => console.log("exit code:", code));
          console.log("terminating");
        });
      `,
      ],
      // The gate env also brings the debug build's outstanding-ticket report
      // forward (2s instead of 10s).
      env: { ...bunEnv, BUN_DEBUG_TEST_WORKER_TEARDOWN_GATE: "draining" },
      stdout: "pipe",
      stderr: "pipe",
    });
    let stdout = "";
    let stderr = "";
    const out = proc.stdout.getReader();
    const err = proc.stderr.getReader();
    const pump = async (
      r: ReadableStreamDefaultReader<Uint8Array>,
      sink: (s: string) => void,
      until: () => boolean,
    ) => {
      const dec = new TextDecoder();
      while (!until()) {
        const { value, done } = await r.read();
        if (done) break;
        sink(dec.decode(value, { stream: true }));
      }
    };
    // terminate() has been called...
    await pump(
      out,
      s => (stdout += s),
      () => stdout.includes("terminating\n"),
    );
    if (isDebug || isASAN) {
      // ...and the wait names what it is waiting for (deterministic: no window)...
      await pump(
        err,
        s => (stderr += s),
        () => /taken at .*node_fs\.rs:\d+/.test(stderr),
      );
      expect(stderr).toContain("ticket(s) still held off-thread");
    } else {
      // ...and long after an idle worker would have gone (milliseconds)...
      await Bun.sleep(500);
    }
    // ...it has not resolved, because the read has not returned.
    expect(stdout).toBe("terminating\n");
    // Release the read: open the FIFO for writing and close it (EOF).
    fs.closeSync(fs.openSync(fifo, "w"));
    await Promise.all([
      pump(
        out,
        s => (stdout += s),
        () => false,
      ),
      pump(
        err,
        s => (stderr += s),
        () => false,
      ),
    ]);
    expect(stdout).toBe("terminating\nexit code: 1\n");
    expect(await proc.exited).toBe(0);
  });
});

// The upload has a ref on the fetch. Destroying the heap drops it for a JS-pumped body, but the stop phase has to
// drop it for a body streamed from a native source. Otherwise LeakSanitizer reports the leaked request.
describe.skipIf(!isASAN || isWindows)("terminating a worker while a request body is still uploading", () => {
  const host = (body: string, fifo: string) => `
    const { Worker } = require("node:worker_threads");
    const fs = require("node:fs");
    const fifo = ${JSON.stringify(fifo)};
    const fifoFd = fs.openSync(fifo, "r+");
    fs.writeSync(fifoFd, Buffer.alloc(64, 1));
    const firstChunk = Promise.withResolvers();
    const target = Bun.serve({
      port: 0,
      async fetch(req) {
        await req.body.getReader().read();
        firstChunk.resolve();
        return new Promise(() => {});
      },
    });
    const upstream = Bun.serve({
      port: 0,
      fetch: () => new Response(new ReadableStream({
        start(c) { c.enqueue(new Uint8Array(1024)); },
        pull() { return new Promise(() => {}); },
      })),
    });
    const worker = new Worker(
      'const { workerData } = require("node:worker_threads");' +
      '(async () => { const body = ' + ${JSON.stringify(body)} + '; fetch(workerData.target, { method: "POST", body }).catch(() => {}); })();',
      { eval: true, workerData: { target: target.url.href, upstream: upstream.url.href, fifo } },
    );
    const exited = new Promise(resolve => worker.on("exit", resolve));
    await firstChunk.promise;
    worker.terminate();
    console.log("worker exit code:", await exited);
    fs.closeSync(fifoFd);
    target.stop(true);
    upstream.stop(true);
  `;

  test.concurrent.each([
    [
      "a JS pull stream",
      `new ReadableStream({ pull(c) { c.enqueue(new Uint8Array(16)); return new Promise(() => {}); } })`,
    ],
    ["another response's body", `(await fetch(workerData.upstream)).body`],
    ["Bun.file(fifo).stream()", `Bun.file(workerData.fifo).stream()`],
  ])("doesn't leak the request when the body is %s", async (_, body) => {
    using dir = tempDir("worker-upload-teardown", {});
    const fifo = path.join(String(dir), "fifo");
    mkfifo(fifo);
    await using proc = Bun.spawn({
      cmd: [bunExe(), "-e", host(body, fifo)],
      env: {
        ...bunEnv,
        BUN_DESTRUCT_VM_ON_EXIT: "1",
        ASAN_OPTIONS: [bunEnv.ASAN_OPTIONS, "detect_leaks=1"].filter(Boolean).join(":"),
        LSAN_OPTIONS: `print_suppressions=0:suppressions=${path.join(import.meta.dirname, "../../../leaksan.supp")}`,
      },
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect({ stdout, leak: stderr.includes("LeakSanitizer") ? stderr : "" }).toEqual({
      stdout: "worker exit code: 1\n",
      leak: "",
    });
    expect(exitCode).toBe(0);
  });
});
