// BUN-2V19 repro: libpas assertion in commit_impl via JSON.stringify buffer growth
//
// Mechanism (Windows-only):
//   tryFastCompactMalloc -> bmalloc compact large heap -> pas_large_sharing_pool_allocate_and_commit
//   -> pas_page_malloc_commit -> commit_impl -> PAS_ASSERT(VirtualAlloc(..., MEM_COMMIT, ...))
//   If VirtualAlloc(MEM_COMMIT) fails (ERROR_COMMITMENT_LIMIT / ERROR_NOT_ENOUGH_MEMORY),
//   libpas retries 10x over ~500ms then asserts -> __builtin_trap() -> IllegalInstruction.
//
// This script constrains the process commit charge via a Windows Job Object
// (JOB_OBJECT_LIMIT_PROCESS_MEMORY) and then drives JSON.stringify to grow its
// UTF-16 output buffer past the commit limit.
//
// Usage:
//   bun repro-bun-2v19.ts           -> parent: spawns self as child under commit limit, reports
//   bun repro-bun-2v19.ts --child   -> child: runs the workload directly (no job object)
//
// Env knobs:
//   HEADROOM_MB  commit headroom above child's measured usage (default 32)
//   PAYLOAD_M    input string length in millions of chars (default 64)
//   RUNS         number of child runs in parent mode (default 10)
//   SCAVENGE_MS  post-warmup sleep to let libpas scavenger decommit (default 1500)
//   NO_WARMUP=1  skip warmup stringify + scavenge wait (control: clean RangeError)

import { dlopen, ptr } from "bun:ffi";

if (process.platform !== "win32") {
  console.error("This repro is Windows-only (libpas symmetric page allocation).");
  process.exit(2);
}

const HEADROOM_MB = Number(process.env.HEADROOM_MB || "32");
const PAYLOAD_M = Number(process.env.PAYLOAD_M || "64");
const RUNS = Number(process.env.RUNS || "10");
const SCAVENGE_MS = Number(process.env.SCAVENGE_MS || "1500");

const k32 = dlopen("kernel32.dll", {
  CreateJobObjectW: { args: ["ptr", "ptr"], returns: "ptr" },
  SetInformationJobObject: { args: ["ptr", "i32", "ptr", "u32"], returns: "i32" },
  AssignProcessToJobObject: { args: ["ptr", "ptr"], returns: "i32" },
  OpenProcess: { args: ["u32", "i32", "u32"], returns: "ptr" },
  GetLastError: { args: [], returns: "u32" },
  CloseHandle: { args: ["ptr"], returns: "i32" },
}).symbols;

const psapi = dlopen("psapi.dll", {
  GetProcessMemoryInfo: { args: ["ptr", "ptr", "u32"], returns: "i32" },
}).symbols;

const JOB_OBJECT_LIMIT_PROCESS_MEMORY = 0x00000100;
const JobObjectExtendedLimitInformation = 9;
const PROCESS_SET_QUOTA = 0x0100;
const PROCESS_TERMINATE = 0x0001;
const PROCESS_QUERY_LIMITED_INFORMATION = 0x1000;

// JOBOBJECT_EXTENDED_LIMIT_INFORMATION layout (x64): 144 bytes total.
//   offset 16: DWORD  LimitFlags
//   offset 112: SIZE_T ProcessMemoryLimit
function makeExtendedLimitInfo(processMemoryLimitBytes: number): Uint8Array {
  const buf = new Uint8Array(144);
  const dv = new DataView(buf.buffer);
  dv.setUint32(16, JOB_OBJECT_LIMIT_PROCESS_MEMORY, true);
  dv.setBigUint64(112, BigInt(processMemoryLimitBytes), true);
  return buf;
}

function commitBytesOf(pid: number): number {
  const hProc = k32.OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, 0, pid);
  if (!hProc) return -1;
  // PROCESS_MEMORY_COUNTERS (x64): 72 bytes; PagefileUsage at offset 56.
  const pmc = new Uint8Array(72);
  const dv = new DataView(pmc.buffer);
  dv.setUint32(0, 72, true); // cb
  const ok = psapi.GetProcessMemoryInfo(hProc, ptr(pmc), 72);
  k32.CloseHandle(hProc);
  if (!ok) return -1;
  return Number(dv.getBigUint64(56, true));
}

async function childWorkload(): Promise<void> {
  // Create a UTF-16 payload: non-ASCII char repeated PAYLOAD_M million times.
  // The non-ASCII char forces FastStringifier<char16_t> (matches crash stack).
  const payload = "\u00e9".repeat(PAYLOAD_M * 1024 * 1024);
  process.stderr.write(
    `[child] payload ready: ${payload.length} chars, rss=${(process.memoryUsage().rss / 1e6) | 0}MB\n`,
  );

  if (!process.env.NO_WARMUP) {
    // Phase 1: warm up the compact large heap with a big output buffer, then drop it.
    // This gives the scavenger something to decommit.
    (function () {
      const out = JSON.stringify(payload);
      process.stderr.write(`[child] warmup: out.length=${out.length}\n`);
    })();
    Bun.gc(true);

    // Phase 2: wait for scavenger to decommit large-heap pages (period ~100-125ms,
    // eligibility delta ~300-600ms). Give it a generous window.
    await Bun.sleep(SCAVENGE_MS);
  } else {
    process.stderr.write(`[child] NO_WARMUP: skipping warmup + scavenge wait\n`);
  }

  // Phase 3: signal parent that we're ready for the commit limit to be applied.
  process.stderr.write("[child] READY\n");

  // Phase 4: wait for parent to apply the job object limit.
  for await (const _ of process.stdin) break;

  // Phase 5: JSON.stringify. The output Vector<char16_t> grows via
  // tryFastCompactMalloc; re-committing the scavenged large-heap range under the
  // commit limit trips the PAS_ASSERT at pas_page_malloc.c:407.
  process.stderr.write("[child] stringify loop start\n");
  const t0 = performance.now();
  for (let i = 0; i < 3; i++) {
    try {
      const out = JSON.stringify(payload);
      process.stderr.write(`[child] iter ${i}: out.length=${out.length}\n`);
    } catch (e) {
      process.stderr.write(`[child] iter ${i}: caught ${String(e).slice(0, 120)}\n`);
    }
  }
  process.stderr.write(`[child] done without crash (${(performance.now() - t0) | 0}ms)\n`);
}

async function parent(): Promise<void> {
  let hits = 0;
  let other = 0;
  const codes: string[] = [];

  for (let run = 0; run < RUNS; run++) {
    const hJob = k32.CreateJobObjectW(null, null);
    if (!hJob) throw new Error(`CreateJobObjectW failed: ${k32.GetLastError()}`);

    const proc = Bun.spawn({
      cmd: [process.execPath, import.meta.path, "--child"],
      env: { ...process.env, PAYLOAD_M: String(PAYLOAD_M) },
      stdin: "pipe",
      stdout: "inherit",
      stderr: "pipe",
    });

    // Wait for child to signal READY (payload built, warmup done, scavenger had time to run).
    let stderrBuf = "";
    const reader = proc.stderr!.getReader();
    const decoder = new TextDecoder();
    while (!stderrBuf.includes("[child] READY")) {
      const { value, done } = await reader.read();
      if (done) break;
      const chunk = decoder.decode(value);
      stderrBuf += chunk;
      process.stderr.write(chunk);
    }

    // Size the commit limit relative to the child's current commit: give it just
    // HEADROOM_MB more. The next JSON.stringify will need to allocate a Vector of
    // ~2*PAYLOAD_M MB, which won't fit.
    const commitBefore = commitBytesOf(proc.pid);
    const limitBytes = commitBefore + HEADROOM_MB * 1024 * 1024;
    const info = makeExtendedLimitInfo(limitBytes);
    if (!k32.SetInformationJobObject(hJob, JobObjectExtendedLimitInformation, ptr(info), info.length)) {
      throw new Error(`SetInformationJobObject failed: ${k32.GetLastError()}`);
    }

    // Apply commit limit to child. Need PROCESS_SET_QUOTA | PROCESS_TERMINATE on the handle.
    const hProc = k32.OpenProcess(PROCESS_SET_QUOTA | PROCESS_TERMINATE, 0, proc.pid);
    if (!hProc) throw new Error(`OpenProcess failed: ${k32.GetLastError()}`);
    if (!k32.AssignProcessToJobObject(hJob, hProc)) {
      throw new Error(`AssignProcessToJobObject failed: ${k32.GetLastError()}`);
    }
    k32.CloseHandle(hProc);
    process.stderr.write(
      `[parent] run ${run}: child commit=${(commitBefore / 1e6) | 0}MB, limit=${(limitBytes / 1e6) | 0}MB (headroom ${HEADROOM_MB}MB)\n`,
    );

    // Let child proceed.
    proc.stdin!.write("go\n");
    proc.stdin!.end();

    // Drain rest of stderr.
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      const chunk = decoder.decode(value);
      stderrBuf += chunk;
      process.stderr.write(chunk);
    }

    const code = await proc.exited;
    k32.CloseHandle(hJob);

    // Windows: illegal instruction via __builtin_trap() surfaces as a nonzero
    // exit code (STATUS_ILLEGAL_INSTRUCTION = 0xC000001D -> exit code -1073741795,
    // or Bun's VEH crash handler catches it first and prints a panic line).
    const codeHex = "0x" + (code >>> 0).toString(16);
    const cleanExit = code === 0 && stderrBuf.includes("done without crash");
    codes.push(cleanExit ? "ok" : codeHex);
    if (!cleanExit) {
      const caughtByBunCrash = stderrBuf.includes("panic") || stderrBuf.includes("Illegal") || stderrBuf.includes("oh no");
      process.stderr.write(
        `[parent] run ${run}: CHILD EXITED ABNORMALLY code=${code} (${codeHex}) crash-handler=${caughtByBunCrash}\n`,
      );
      hits++;
    } else {
      process.stderr.write(`[parent] run ${run}: survived\n`);
      other++;
    }
  }

  console.log(
    JSON.stringify({
      bun: Bun.version + "+" + Bun.revision.slice(0, 9),
      headroomMB: HEADROOM_MB,
      payloadMChars: PAYLOAD_M,
      runs: RUNS,
      abnormalExits: hits,
      survived: other,
      codes,
    }),
  );
}

if (process.argv.includes("--child")) {
  await childWorkload();
} else {
  await parent();
}
