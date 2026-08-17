// ICU's heap is routed through mimalloc (src/jsc/bindings/bun_icu_malloc.cpp),
// so on Windows a transient commit-limit refusal is retried instead of turning
// into "failed to initialize Segments" / a segfault inside ubrk_clone.
import { dlopen, FFIType, ptr } from "bun:ffi";
import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, isWindows } from "harness";
import { join } from "path";

describe("ICU allocator", () => {
  // Puts a child in a Job Object with a commit cap right above its current
  // commit, lets it run into the cap while cloning ICU break iterators, and
  // lifts the cap 150ms later — a transient refusal, like a slow pagefile
  // growth step. With ICU on the CRT heap, its malloc got NULL immediately and
  // Intl.Segmenter threw "failed to initialize Segments" or segfaulted in
  // RuleBasedBreakIterator::BreakCache::reset.
  test.skipIf(!isWindows)(
    "Intl.Segmenter survives a transient commit-limit failure",
    async () => {
      const k32 = dlopen("kernel32.dll", {
        CreateJobObjectW: { args: [FFIType.ptr, FFIType.ptr], returns: FFIType.ptr },
        SetInformationJobObject: { args: [FFIType.ptr, FFIType.u32, FFIType.ptr, FFIType.u32], returns: FFIType.i32 },
        AssignProcessToJobObject: { args: [FFIType.ptr, FFIType.ptr], returns: FFIType.i32 },
        OpenProcess: { args: [FFIType.u32, FFIType.i32, FFIType.u32], returns: FFIType.ptr },
        CloseHandle: { args: [FFIType.ptr], returns: FFIType.i32 },
        GetLastError: { args: [], returns: FFIType.u32 },
      }).symbols;

      const JobObjectExtendedLimitInformation = 9;
      const JOB_OBJECT_LIMIT_PROCESS_MEMORY = 0x100;
      const PROCESS_SET_QUOTA = 0x0100;
      const PROCESS_TERMINATE = 0x0001;
      // JOBOBJECT_EXTENDED_LIMIT_INFORMATION: LimitFlags @16, ProcessMemoryLimit @112, 144 bytes.
      const info = new Uint8Array(144);
      const setLimit = (job: unknown, bytes: number) => {
        const dv = new DataView(info.buffer);
        dv.setUint32(16, bytes > 0 ? JOB_OBJECT_LIMIT_PROCESS_MEMORY : 0, true);
        dv.setBigUint64(112, BigInt(Math.max(bytes, 0)), true);
        if (!k32.SetInformationJobObject(job, JobObjectExtendedLimitInformation, ptr(info), info.byteLength)) {
          throw new Error("SetInformationJobObject failed: " + k32.GetLastError());
        }
      };

      const runOnce = async () => {
        const job = k32.CreateJobObjectW(null, null);
        expect(job).toBeTruthy();
        try {
          await using proc = Bun.spawn({
            cmd: [bunExe(), join(import.meta.dir, "icu-allocator-fixture.ts")],
            env: bunEnv,
            stdin: "pipe",
            stdout: "pipe",
            stderr: "pipe",
          });
          const stderrPromise = proc.stderr.text();

          let stdout = "";
          let result: { errors: number; messages: string[]; kept: number; after: string } | undefined;
          let assigned = false;
          let lifted = false;
          const decoder = new TextDecoder();
          for await (const chunk of proc.stdout) {
            stdout += decoder.decode(chunk, { stream: true });
            if (!assigned) {
              const ready = /READY (\d+)\n/.exec(stdout);
              if (ready) {
                assigned = true;
                const limitMB = Number(ready[1]) + 48;
                setLimit(job, limitMB * 1048576);
                const handle = k32.OpenProcess(PROCESS_SET_QUOTA | PROCESS_TERMINATE, 0, proc.pid);
                expect(handle).toBeTruthy();
                try {
                  if (!k32.AssignProcessToJobObject(job, handle)) {
                    throw new Error("AssignProcessToJobObject failed: " + k32.GetLastError());
                  }
                } finally {
                  k32.CloseHandle(handle);
                }
                proc.stdin.write(`GO ${limitMB}\n`);
                await proc.stdin.flush();
              }
            }
            if (!lifted && stdout.includes("EDGE\n")) {
              lifted = true;
              // The refusal has to outlast the allocation attempt but stay well
              // inside every allocator's retry budget (mimalloc 400ms, libpas 500ms).
              await Bun.sleep(150);
              setLimit(job, 0);
              proc.stdin.write("LIFTED\n");
              await proc.stdin.flush();
            }
            const done = /RESULT (.+)\n/.exec(stdout);
            if (done) result = JSON.parse(done[1]);
          }
          const [stderr, exitCode] = await Promise.all([stderrPromise, proc.exited]);
          return { stdout, stderr, exitCode, result };
        } finally {
          k32.CloseHandle(job);
        }
      };

      for (let i = 0; i < 3; i++) {
        const { stdout, stderr, exitCode, result } = await runOnce();
        const output = stdout + stderr;
        expect(output).not.toContain("failed to initialize");
        expect(output).not.toContain("Segmentation fault");
        expect(result).toBeDefined();
        expect(result!.messages).toEqual([]);
        expect(result!.errors).toBe(0);
        expect(result!.after).toBe("12 2 1,234,567.891");
        expect(exitCode).toBe(0);
      }
    },
    30_000,
  );
});
