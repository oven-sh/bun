import { expect, test } from "bun:test";
import { bunEnv, bunExe, isLinux } from "harness";
import { readdirSync, readFileSync } from "node:fs";

// On Linux, threads count toward RLIMIT_NPROC (the same counter a cgroup
// pids.max enforces). The kernel does not enforce the limit for root, so a
// root test runner drops to `nobody` through runuser.
const isRoot = process.getuid?.() === 0;
const hasPrlimit = isLinux && !!Bun.which("prlimit");
const nobodyUid = (() => {
  if (!isLinux || !isRoot || !Bun.which("runuser")) return undefined;
  const uid = readFileSync("/etc/passwd", "utf8")
    .split("\n")
    .find(line => line.startsWith("nobody:"))
    ?.split(":")[2];
  return uid === undefined ? undefined : Number(uid);
})();
const canLimitThreads = hasPrlimit && (!isRoot || nobodyUid !== undefined);

/** Threads that already belong to `uid`. RLIMIT_NPROC is per uid, not per process. */
function threadsOwnedBy(uid: number): number {
  let total = 0;
  for (const pid of readdirSync("/proc")) {
    if (!/^\d+$/.test(pid)) continue;
    let status: string;
    try {
      status = readFileSync(`/proc/${pid}/status`, "utf8");
    } catch {
      continue;
    }
    const owner = status.match(/^Uid:\s+(\d+)/m);
    if (!owner || Number(owner[1]) !== uid) continue;
    const threads = status.match(/^Threads:\s+(\d+)/m);
    total += threads ? Number(threads[1]) : 1;
  }
  return total;
}

// Every script first proves that the limit is in force (a child cannot be
// spawned), then runs one operation and prints a JSON line.
const prelude = `
  const { spawnSync } = require("node:child_process");
  const limited = spawnSync("true").error?.code ?? null;
  const print = result => console.log(JSON.stringify({ limited, ...result }));
`;

/** Runs `script` in a bun whose uid may own `extraThreads` threads more than it does now. */
function spawnWithThreadLimit(extraThreads: number, script: string) {
  const uid = isRoot ? nobodyUid! : process.getuid!();
  const limit = threadsOwnedBy(uid) + extraThreads;
  const cmd = [Bun.which("prlimit")!, `--nproc=${limit}`, bunExe(), "-e", prelude + script];
  if (isRoot) cmd.unshift(Bun.which("runuser")!, "-u", "nobody", "--");
  return Bun.spawn({
    cmd,
    env: {
      ...bunEnv,
      // `nobody` has no writable home.
      HOME: "/tmp",
      // `bun -e` turns the concurrent JIT off and marks with one thread. Ask
      // for the threads a script run from a file asks for, on any core count.
      BUN_JSC_useConcurrentJIT: "1",
      BUN_JSC_numberOfGCMarkers: "4",
      // LeakSanitizer needs a tracer thread at exit, which this limit refuses.
      ASAN_OPTIONS: [bunEnv.ASAN_OPTIONS, "detect_leaks=0"].filter(Boolean).join(":"),
    },
    stdout: "pipe",
    stderr: "pipe",
  });
}

async function run(extraThreads: number, script: string) {
  await using proc = spawnWithThreadLimit(extraThreads, script);
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  expect(exitCode, stderr).toBe(0);
  return JSON.parse(stdout);
}

test.skipIf(!canLimitThreads)("a loop that tiers up under a thread limit does not abort the process", async () => {
  // Room for the main thread only. The first hot loop asks the JIT worklist
  // for a compiler thread, which the OS refuses. The code compiles on the main
  // thread instead.
  const result = await run(
    1,
    `
    let sum = 0;
    for (let i = 0; i < 200000; i++) sum += i % 7;
    print({ sum });
  `,
  );
  expect(result).toEqual({ limited: "EAGAIN", sum: 599994 });
});

test.skipIf(!canLimitThreads)("a GC under a thread limit does not abort the process", async () => {
  // Room for the main thread only. The parallel markers and the collector
  // thread get no thread, so the collection has to finish on the main thread.
  // An async collection first: it is the one a server runs, and it must end
  // before the sync one behind it.
  const result = await run(
    1,
    `
    let keep = [];
    for (let i = 0; i < 200; i++) {
      keep.push(new Array(10000).fill({ i }));
      if (i % 50 === 0) keep = [];
    }
    Bun.gc(false);
    await new Promise(resolve => setTimeout(resolve, 1));
    Bun.gc(true);
    print({ ok: true });
  `,
  );
  expect(result).toEqual({ limited: "EAGAIN", ok: true });
});

test.skipIf(!canLimitThreads)("a WebAssembly compile under a thread limit does not abort the process", async () => {
  // Wasm plans always run on a worklist thread, even without the concurrent
  // JIT. With no thread, the compile runs on the main thread.
  const result = await run(
    1,
    `
    const empty = new Uint8Array([0, 97, 115, 109, 1, 0, 0, 0]);
    const valid = WebAssembly.validate(empty);
    const mod = new WebAssembly.Module(empty);
    print({ valid, exports: WebAssembly.Module.exports(mod).length });
  `,
  );
  expect(result).toEqual({ limited: "EAGAIN", valid: true, exports: 0 });
});

test.skipIf(!canLimitThreads)("a node:vm timeout under a thread limit does not abort the process", async () => {
  // The timeout's timer lives on a JSC work queue thread. With no thread the
  // script still runs, the timeout is not enforced.
  const result = await run(
    1,
    `
    const vm = require("node:vm");
    const value = vm.runInNewContext("1 + 1", {}, { timeout: 1000 });
    print({ value });
  `,
  );
  expect(result).toEqual({ limited: "EAGAIN", value: 2 });
});
