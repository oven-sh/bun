// When a worker is gone by the time another thread finishes work the worker
// started, that thread's completion is refused at the worker's VM handle and
// the producer releases what it owns itself. Here that path runs
// deterministically for one producer at a time: with
// BUN_DEBUG_TEST_WORKER_REFUSAL_GATE the completion waits for the worker's
// handle to close and is then refused, and the runtime names each refusal on
// stderr. A row passes only if the named refusal happened (the work really was
// on another thread and its release path ran) and the process exited cleanly;
// on the ASAN build the release path is also checked for use-after-free and
// leaks. Builds with debug assertions only (debug, ASAN): the gate does not
// exist in release builds.
import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, isASAN, isDebug, isWindows } from "harness";

type Row = {
  name: string;
  // Runs in the worker before it exits; starts exactly one piece of off-thread work.
  worker: string;
  // Substring of the refusal the runtime must log for it.
  refused: string;
  // Runs in the parent once the worker says it is set up (for producers on the parent's side).
  parent?: string;
  env?: Record<string, string>;
  skip?: boolean;
};

const ROWS: Row[] = [
  {
    name: "fs.readFile",
    worker: `require("node:fs").readFile(process.execPath, () => {});`,
    refused: "args::ReadFile",
  },
  { name: "fs.promises.stat", worker: `require("node:fs").promises.stat(process.execPath);`, refused: "args::Stat" },
  {
    name: "fs.realpath",
    worker: `require("node:fs").realpath(process.execPath, () => {});`,
    refused: "args::Realpath",
  },
  {
    name: "Bun.file().text()",
    worker: `Bun.file(process.execPath).slice(0, 65536).text();`,
    refused: "blob::read_file::ReadFile",
  },
  {
    // Same read job, different completion: the image's read chain is handed
    // ECANCELED at teardown and has to free itself.
    name: "Bun.Image(Bun.file()).metadata()",
    worker: `new Bun.Image(Bun.file(process.execPath).slice(0, 65536)).metadata().catch(() => {});`,
    refused: "blob::read_file::ReadFile",
  },
  {
    name: "crypto.pbkdf2",
    worker: `require("node:crypto").pbkdf2("p", "s", 1000, 32, "sha256", () => {});`,
    refused: "Pbkdf2Job",
  },
  { name: "crypto.scrypt", worker: `require("node:crypto").scrypt("p", "s", 32, () => {});`, refused: "ScryptJob" },
  {
    name: "crypto.randomFill",
    worker: `require("node:crypto").randomFill(Buffer.alloc(65536), () => {});`,
    refused: "RandomFillJob",
  },
  {
    name: "crypto.generateKeyPair",
    worker: `require("node:crypto").generateKeyPair("ec", { namedCurve: "P-256" }, () => {});`,
    refused: "EcKeyPairJob",
  },
  {
    name: "crypto.subtle.digest",
    worker: `crypto.subtle.digest("SHA-256", Buffer.alloc(65536));`,
    refused: "refused post: CppTask",
  },
  {
    name: "Bun.password.hash",
    worker: `Bun.password.hash("x", { algorithm: "bcrypt", cost: 4 });`,
    refused: "PasswordJob",
  },
  {
    name: "Bun.Glob scan",
    worker: `new Bun.Glob("*").scan({ cwd: require("node:os").tmpdir() })[Symbol.asyncIterator]().next();`,
    refused: "glob::WalkTask",
  },
  {
    name: "dns lookup on the thread pool",
    worker: `Bun.dns.lookup("localhost", { backend: "libc" });`,
    refused: "get_addr_info_request::LibcLookup",
  },
  {
    name: "child exit reported by the waiter thread",
    worker: `require("node:child_process").execFile(process.execPath, ["-e", "0"], () => {});`,
    refused: "ProcessWaiterThreadTask",
    // The waiter thread is a POSIX fallback path, opted into here the way the runtime's own tests do.
    env: { BUN_GARBAGE_COLLECTOR_LEVEL: "0", BUN_FEATURE_FLAG_FORCE_WAITER_THREAD: "1" },
    skip: isWindows,
  },
  {
    name: "BroadcastChannel message from another thread",
    worker: `const bc = new BroadcastChannel("wrc"); bc.onmessage = () => {};`,
    // An open channel keeps the parent's loop alive (as in Node); close it once posted.
    parent: `const pc = new BroadcastChannel("wrc"); pc.postMessage("late"); pc.close();`,
    refused: "refused post: CppTask",
  },
  {
    name: "MessagePort message from another thread",
    worker: `workerData.port.on("message", () => {});`,
    parent: `port1.postMessage("late");`,
    refused: "refused post: CppTask",
  },
];

// The host: one worker, armed gate. The worker starts its work, reports
// "armed" and exits by itself two turns later; the parent never posts anything
// the worker waits for (with the gate armed, a parent→worker post is itself a
// cross-thread completion that waits for the worker's close). Rows with a
// parent side post in response to "armed": that post is what gets refused.
function host(row: Row) {
  return `
    const { Worker, MessageChannel } = require("node:worker_threads");
    const { port1, port2 } = new MessageChannel();
    const w = new Worker(\`
      const { parentPort, workerData } = require("node:worker_threads");
      parentPort.on("message", () => {});
      ${row.worker.replace(/`/g, "\\`").replace(/\$\{/g, "\\${")}
      parentPort.postMessage("armed");
      setImmediate(() => setImmediate(() => process.exit(0)));
    \`, { eval: true, workerData: { port: port2 }, transferList: [port2] });
    w.on("error", e => { console.error("worker error:", e && e.message); process.exitCode = 1; });
    w.once("message", () => { ${row.parent ?? ""} });
    w.on("exit", code => { port1.close(); if (code !== 0) { console.error("worker exit code", code); process.exitCode = 1; } });
  `;
}

describe.skipIf(!isDebug && !isASAN)(
  "a completion for a worker that is gone is refused and released by its producer",
  () => {
    for (const row of ROWS) {
      test.concurrent.skipIf(!!row.skip)(row.name, async () => {
        await using proc = Bun.spawn({
          cmd: [bunExe(), "-e", host(row)],
          env: { ...bunEnv, ...row.env, BUN_DEBUG_TEST_WORKER_REFUSAL_GATE: "1" },
          stdout: "pipe",
          stderr: "pipe",
        });
        const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
        const refusals = stderr.split("\n").filter(l => l.startsWith("[vm_handle] refused "));
        expect({
          exitCode,
          refused: refusals.some(l => l.includes(row.refused)),
          // On a failure, everything the host printed.
          detail: exitCode === 0 && refusals.some(l => l.includes(row.refused)) ? "" : stdout + stderr,
        }).toEqual({ exitCode: 0, refused: true, detail: "" });
      });
    }
  },
);
