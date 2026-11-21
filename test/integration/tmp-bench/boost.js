// Usage: bun boost.js   The priority of a thread before it waits on a port, and after each way to end that wait.
const { dlopen } = require("bun:ffi"), { Worker, isMainThread, workerData } = require("worker_threads");
const k = dlopen("kernel32.dll", { CreateIoCompletionPort: { args: ["i64", "u64", "u64", "u32"], returns: "u64" }, CreateEventW: { args: ["ptr", "i32", "i32", "ptr"], returns: "u64" }, SetEvent: { args: ["u64"], returns: "i32" }, OpenThread: { args: ["u32", "i32", "u32"], returns: "u64" }, GetCurrentThreadId: { returns: "u32" } }).symbols;
const nt = dlopen("ntdll.dll", {
  NtQueryInformationThread: { args: ["i64", "u32", "ptr", "u32", "ptr"], returns: "i32" }, NtSetInformationThread: { args: ["i64", "u32", "ptr", "u32"], returns: "u32" },
  NtCreateWaitCompletionPacket: { args: ["ptr", "u32", "ptr"], returns: "u32" }, NtAssociateWaitCompletionPacket: { args: ["u64", "u64", "u64", "u64", "u64", "u32", "u64", "ptr"], returns: "u32" },
  NtSetIoCompletion: { args: ["u64", "u64", "u64", "u32", "u64"], returns: "u32" }, NtRemoveIoCompletionEx: { args: ["u64", "ptr", "u32", "ptr", "ptr", "u8"], returns: "u32" }, NtAlertThread: { args: ["u64"], returns: "u32" },
}).symbols;
const N_RUNS = +(process.env.N ?? 40), burn = ms => { for (const end = performance.now() + ms; performance.now() < end; ); };
if (!isMainThread) {
  const { flag, port, event, thread } = workerData;
  for (let seen = 0; ; ) { Atomics.wait(flag, 0, seen); seen = flag[0]; Bun.sleepSync(20); [() => nt.NtSetIoCompletion(port, 1n, 0n, 0, 0n), () => k.SetEvent(event), () => nt.NtAlertThread(thread), () => {}][flag[1]](); }
} else {
  const info = new Int32Array(12), priority = () => (nt.NtQueryInformationThread(-2n, 0, info, 48, null), info[10]);
  const port = k.CreateIoCompletionPort(-1n, 0n, 0n, 1), event = k.CreateEventW(null, 0, 0, null), thread = k.OpenThread(0x1fffff, 0, k.GetCurrentThreadId()), out = new BigUint64Array(1), flag = new Int32Array(new SharedArrayBuffer(8));
  nt.NtCreateWaitCompletionPacket(out, 0x10000000, null);
  const packet = out[0], entries = new BigUint64Array(4), removed = new Uint32Array(1), timeout = new BigInt64Array([-2000000n]);
  new Worker(__filename, { workerData: { flag, port, event, thread } }).on("online", () => {
    for (const [i, name] of ["posted", "event", "alert", "timeout"].entries()) {
      const seen = [];
      for (let round = 0; round < 3; round++) {
        burn(450);
        if (name === "event") nt.NtAssociateWaitCompletionPacket(packet, port, event, 2n, 0n, 0, 0n, null);
        const before = priority();
        (flag[1] = i), Atomics.add(flag, 0, 1), Atomics.notify(flag, 0);
        const status = nt.NtRemoveIoCompletionEx(port, entries, 1, removed, timeout, +(name === "alert"));
        seen.push(`${before} to ${priority()} (${status.toString(16)})`);
      }
      console.log(`cond boost ${name}: ${seen.join(", ")}`);
    }
    const kept = [];
    for (const ms of [1, 10, 20, 40, 70, 120, 250, 500]) {
      burn(450), nt.NtAssociateWaitCompletionPacket(packet, port, event, 2n, 0n, 0, 0n, null), (flag[1] = 1), Atomics.add(flag, 0, 1), Atomics.notify(flag, 0), nt.NtRemoveIoCompletionEx(port, entries, 1, removed, timeout, 0);
      const before = priority();
      nt.NtRemoveIoCompletionEx(port, entries, 1, removed, new BigInt64Array([BigInt(-ms * 10000)]), 0), kept.push(`${ms} ms: ${before} to ${priority()}`);
    }
    console.log(`cond boost over a wait that times out: ${kept.join(", ")}`);
    burn(450);
    const seen = [priority(), "set " + nt.NtSetInformationThread(-2n, 2, new Int32Array([9]), 4).toString(16), priority(), "base " + info[11]];
    for (const ms of [10, 30, 60, 120, 240]) burn(ms), seen.push(`after ${ms} more ${priority()}`);
    console.log(`cond boost by hand: ${seen.join(", ")}`);
    const N = 200000, time = f => { const t = performance.now(); for (let i = 0; i < N; i++) f(); return (((performance.now() - t) * 1000) / N).toFixed(2); }, now = new BigInt64Array(1), take = () => nt.NtRemoveIoCompletionEx(port, entries, 1, removed, now, 0);
    console.log(`cond boost us for post + take ${time(() => (nt.NtSetIoCompletion(port, 1n, 0n, 0, 0n), take()))}, arm + set + take ${time(() => (nt.NtAssociateWaitCompletionPacket(packet, port, event, 2n, 0n, 0, 0n, null), k.SetEvent(event), take()))}, query ${time(priority)}`);
    const test = require("fs").readFileSync(require("path").join(__dirname, "../../js/node/fs/fs.test.ts"), "utf8"), code = /`(import \{ dlopen \} from "bun:ffi";\s+import \{ openSync, read \}[\s\S]*?> timer\);)`/.exec(test)[1];
    for (const [name, exe] of Object.entries({ old: process.argv[2], before: process.env.BEFORE_BUN, new: process.argv[3] })) {
      const seen = {}, t = performance.now();
      for (let i = 0; i < N_RUNS; i++) { const out = Bun.spawnSync([exe, "-e", code], { env: { ...process.env, BUN_GC_TIMER_DISABLE: "1", UV_THREADPOOL_SIZE: "1" }, stderr: "inherit" }).stdout.toString().trim(); seen[out] = (seen[out] ?? 0) + 1; }
      console.log(`cond boost the test, ${name}: ${JSON.stringify(seen)}, ${((performance.now() - t) / N_RUNS).toFixed(0)} ms each`);
    }
    process.exit(0);
  });
}
