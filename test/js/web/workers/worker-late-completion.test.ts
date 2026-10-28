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
// with BUN_DEBUG_TEST_WORKER_TEARDOWN_GATE the other thread's post is held
// until the worker's teardown is already waiting, so it always lands *during*
// the wait, and the runtime names it on stderr. A row passes only if the named
// line appeared (the work really was on another thread, really came back
// during teardown, and — for ticketed work — was taken through the door at
// the expected site) and the process exited cleanly; on the ASAN build the
// release paths are also checked for use-after-free and leaks. Builds with
// debug assertions only (debug, ASAN): the gate does not exist in release.
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
type Ticketed = { ticket: string; weak?: never };
// Weak posters: the task tag logged by "[vm] late post: <tag> (...)".
type Weak = { weak: string; ticket?: never };

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
function host(row: Row, dir: string) {
  const worker = `
    const { parentPort, workerData } = require("node:worker_threads");
    parentPort.on("message", () => {});
    ${row.worker}
    parentPort.postMessage("armed");
    setImmediate(() => setImmediate(() => process.exit(0)));
  `;
  return `
    const { Worker, MessageChannel } = require("node:worker_threads");
    const { port1, port2 } = new MessageChannel();
    const data = { port: port2, dir: ${JSON.stringify(dir)} };
    ${row.prelude ?? ""}
    const w = new Worker(${JSON.stringify(worker)}, { eval: true, workerData: data, transferList: [port2] });
    w.on("error", e => { console.error("worker error:", e && e.message); process.exitCode = 1; });
    w.once("message", () => { ${row.parent ?? ""} });
    w.on("exit", code => { port1.close(); ${row.onExit ?? ""} if (code !== 0) { console.error("worker exit code", code); process.exitCode = 1; } });
  `;
}

describe.skipIf(!isDebug && !isASAN)("work that comes back after its worker began tearing down", () => {
  for (const row of ROWS) {
    test.concurrent.skipIf(!!row.skip)(row.name, async () => {
      using dir = tempDir("worker-late-completion", row.files ?? {});
      await using proc = Bun.spawn({
        cmd: [bunExe(), "-e", host(row, String(dir))],
        env: { ...bunEnv, ...row.env, BUN_DEBUG_TEST_WORKER_TEARDOWN_GATE: "1" },
        stdout: "pipe",
        stderr: "pipe",
      });
      const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
      const lines = stderr.split("\n").filter(l => l.startsWith("[vm] "));
      const seen =
        "ticket" in row && row.ticket
          ? lines.some(l => l.startsWith("[vm] late completion from ") && l.includes(row.ticket))
          : lines.some(l => l.startsWith(`[vm] late post: ${row.weak} (`));
      expect({
        exitCode,
        seen,
        // On a failure, everything the host printed.
        detail: exitCode === 0 && seen ? "" : stdout + stderr,
      }).toEqual({ exitCode: 0, seen: true, detail: "" });
    });
  }
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

// `Bun.write(file, file)` copies on a pool thread. When the other end of a FIFO,
// pipe or socket is silent, that thread waits in a poll that the worker's stop
// phase wakes, so the worker goes away and the copy never settles.
describe.skipIf(isWindows)("terminate() cancels a Bun.write(file, file) that waits for the other end", () => {
  // "socket": what Bun.spawn hands a child for "pipe". "fifo": a FIFO this test
  // holds open read-write and never reads or writes, so the child's end has a
  // peer that stays silent.
  type Stdio = "socket" | "fifo";
  type Row = {
    name: string;
    copies: string[];
    stdin?: Stdio;
    stdout?: Stdio;
    end?: "terminate" | "exit";
    skip?: boolean;
  };
  const rows: Row[] = [
    {
      name: "a FIFO source into Bun.stdout (a pipe): one that nobody writes to, one whose writer is silent",
      copies: [`Bun.write(Bun.stdout, Bun.file(d.fifo))`, `Bun.write(Bun.stdout, Bun.file(d.held))`],
      stdout: "fifo",
    },
    {
      // macOS and FreeBSD still open the destination with an open(2) that waits for the reader.
      name: "a FIFO destination that nobody reads",
      copies: [`Bun.write(Bun.file(d.fifo), Bun.file(d.small))`],
      skip: !isLinux && !isAndroid,
    },
    {
      name: "Bun.stdin (a socket) into Bun.stdout (a socket) and into a file",
      copies: [
        `Bun.write(Bun.stdout, Bun.stdin)`,
        `Bun.write(d.out, Bun.stdin)`,
        `Bun.write(d.out + "2", Bun.file(0))`,
      ],
    },
    {
      name: "Bun.stdin (a pipe) into Bun.stdout (a pipe)",
      copies: [`Bun.write(Bun.stdout, Bun.stdin)`],
      stdin: "fifo",
      stdout: "fifo",
    },
    {
      name: "Bun.stdin (a socket) into Bun.stdout (a pipe)",
      copies: [`Bun.write(Bun.stdout, Bun.stdin)`],
      stdout: "fifo",
    },
    {
      // macOS and FreeBSD write to a pipe that they did not open with a write(2) that waits for room.
      name: "a file into Bun.stdout, a pipe that nobody drains",
      copies: [`Bun.write(Bun.stdout, Bun.file(d.big))`],
      stdout: "fifo",
      skip: !isLinux && !isAndroid,
    },
    {
      name: "a file into a socket that nobody drains",
      copies: [`Bun.write(Bun.file(3), Bun.file(d.big))`],
    },
    {
      name: "the worker's own process.exit(), with Bun.stdin (a socket) into Bun.stdout",
      copies: [`Bun.write(Bun.stdout, Bun.stdin)`],
      end: "exit",
    },
  ];
  test.concurrent.each(rows.filter(row => !row.skip).map(row => [row.name, row] as const))("%s", async (_, row) => {
    using dir = tempDir("worker-terminate-cancels-copy", {
      "small.txt": "a regular file\n",
      "big.bin": Buffer.alloc(1024 * 1024, "x"),
    });
    const d = {
      out: path.join(String(dir), "out.bin"),
      small: path.join(String(dir), "small.txt"),
      big: path.join(String(dir), "big.bin"),
      fifo: path.join(String(dir), "fifo"),
      held: path.join(String(dir), "held"),
    };
    mkfifo(d.fifo);
    mkfifo(d.held);
    const held: number[] = [fs.openSync(d.held, "r+")];
    const stdio = (name: string, kind: Stdio | undefined) => {
      if (kind !== "fifo") return "pipe";
      const fifo = path.join(String(dir), name);
      mkfifo(fifo);
      held.push(fs.openSync(fifo, "r+"));
      return held.at(-1)!;
    };
    // A copy that waits has one fd more than the files it opened: the fd that wakes it. The worker goes on
    // once the process has one more fd for each copy. A terminate() that comes before a pool thread takes a
    // copy skips that copy, so it would prove nothing.
    const worker = `
      const { parentPort, workerData: d } = require("node:worker_threads");
      const fds = () => require("node:fs").readdirSync(process.platform === "linux" ? "/proc/self/fd" : "/dev/fd").length;
      const before = fds();
      let settled = false;
      const settle = how => () => ((settled = true), parentPort.postMessage(how));
      const copies = [${row.copies.join(", ")}];
      for (const copy of copies) copy.then(settle("resolved"), settle("rejected"));
      (async () => {
        while (!settled && fds() < before + copies.length) await Bun.sleep(1);
        ${row.end === "exit" ? "process.exit(0);" : `parentPort.postMessage("copying");`}
      })();
    `;
    try {
      await using proc = Bun.spawn({
        cmd: [
          bunExe(),
          "-e",
          `
          // The child of a test that timed out must not stay behind: nothing else ends it.
          setTimeout(() => process.exit(1), 30_000).unref();
          const { Worker } = require("node:worker_threads");
          const w = new Worker(${JSON.stringify(worker)}, { eval: true, workerData: ${JSON.stringify(d)} });
          w.on("error", error => console.error("worker error:", error));
          const seen = [];
          w.on("message", async message => {
            seen.push(message);
            if (message === "copying") console.error(JSON.stringify({ code: await w.terminate(), seen }));
          });
          ${row.end === "exit" ? `w.once("exit", code => console.error(JSON.stringify({ code, seen })));` : ""}
        `,
        ],
        env: bunEnv,
        // fd 3: a socket whose other end this test never reads.
        stdio: [stdio("stdin", row.stdin), stdio("stdout", row.stdout), "pipe", "pipe"],
      });
      const [stderr, exitCode] = await Promise.all([proc.stderr.text(), proc.exited]);
      // A copy that settled would be in `seen`.
      expect(stderr.trim()).toBe(
        JSON.stringify(row.end === "exit" ? { code: 0, seen: [] } : { code: 1, seen: ["copying"] }),
      );
      expect(exitCode).toBe(0);
    } finally {
      for (const fd of held) fs.closeSync(fd);
    }
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
          { eval: true, workerData: fifo },
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
      env: { ...bunEnv, BUN_DEBUG_TEST_WORKER_TEARDOWN_GATE: "1" },
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
