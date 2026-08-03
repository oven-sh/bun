// Exercises uv_spawn's post-CreateProcessW failure paths on Windows by
// IAT-hooking AssignProcessToJobObject / ResumeThread to fail, then spawning
// repeatedly and checking process handle count for leaks. Prints one JSON
// line per scenario so the test can assert on structure.

import { dlopen, FFIType, suffix } from "bun:ffi";
import { join } from "node:path";

const dllPath = process.env.SPAWN_FAULT_DLL
  ?? join(import.meta.dirname, `spawn-fault-inject.${suffix}`);

const {
  symbols: {
    install_hooks,
    set_fail_job,
    set_fail_resume,
    get_job_fail_count,
    get_resume_fail_count,
    handle_count,
  },
} = dlopen(dllPath, {
  install_hooks: { args: [], returns: FFIType.i32 },
  set_fail_job: { args: [FFIType.i32], returns: FFIType.void },
  set_fail_resume: { args: [FFIType.i32], returns: FFIType.void },
  get_job_fail_count: { args: [], returns: FFIType.i32 },
  get_resume_fail_count: { args: [], returns: FFIType.i32 },
  handle_count: { args: [], returns: FFIType.u32 },
});

const cmd = [process.execPath, "-e", "1"];
const N = Number(process.env.SPAWN_FAULT_N ?? 200);

async function warmup() {
  // One successful spawn so uv_global_job_handle_ exists and one-time
  // allocations (first-call heaps, loader locks) are out of the way before
  // we sample the handle baseline.
  const p = Bun.spawn({ cmd, stdio: ["ignore", "ignore", "ignore"] });
  await p.exited;
}

function emit(tag: string, data: Record<string, unknown>) {
  console.log(JSON.stringify({ tag, ...data }));
}

async function exercise(tag: string, detached: boolean, calls: () => number) {
  Bun.gc(true);
  const before = handle_count();
  let threw = 0;
  let sawCode: string | undefined;
  let sawSyscall: string | undefined;
  let otherErr: string | undefined;
  for (let i = 0; i < N; i++) {
    try {
      const p = Bun.spawn({ cmd, stdio: ["ignore", "ignore", "ignore"], detached });
      await p.exited;
    } catch (e: any) {
      threw++;
      sawCode ??= e?.code;
      sawSyscall ??= e?.syscall;
      if (e?.syscall !== "uv_spawn") otherErr ??= String(e);
    }
  }
  Bun.gc(true);
  const after = handle_count();
  emit(tag, {
    iterations: N,
    threw,
    hookCalls: calls(),
    code: sawCode,
    syscall: sawSyscall,
    otherErr,
    handlesBefore: before,
    handlesAfter: after,
    delta: after - before,
  });
}

await warmup();

const hooked = install_hooks();
emit("hooks", {
  assignProcessToJobObject: (hooked & 1) !== 0,
  resumeThread: (hooked & 2) !== 0,
});

// Path A: non-detached spawn, AssignProcessToJobObject returns
// ERROR_INVALID_HANDLE. CREATE_SUSPENDED is not set, so ResumeThread is not
// reached.
set_fail_resume(0);
set_fail_job(1);
await exercise("assignProcessToJobObject", false, () => get_job_fail_count());
set_fail_job(0);

// Recover: one clean spawn to prove the process is still healthy.
{
  const p = Bun.spawn({ cmd, stdio: ["ignore", "ignore", "ignore"] });
  const code = await p.exited;
  emit("recover-after-A", { exitCode: code });
}

// Path B: detached spawn sets CREATE_SUSPENDED; ResumeThread returns -1 with
// ERROR_INVALID_HANDLE. AssignProcessToJobObject is skipped for detached.
set_fail_job(0);
set_fail_resume(1);
await exercise("resumeThread", true, () => get_resume_fail_count());
set_fail_resume(0);

{
  const p = Bun.spawn({ cmd, stdio: ["ignore", "ignore", "ignore"], detached: true });
  const code = await p.exited;
  emit("recover-after-B", { exitCode: code });
}
