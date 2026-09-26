import { describe, expect, it } from "bun:test";
import { bunEnv, bunExe, bunRun, isAndroid, isLinux, isMusl, isPosix, isWindows } from "harness";
import { totalmem } from "os";
import { join } from "path";

// The fields of a spawnSync result that the assertions compare, with the
// Buffers turned into strings. `signalCode`, `exitedDueToTimeout` and
// `exitedDueToMaxBuffer` are undefined unless a signal, a timeout or a
// maxBuffer applied; `stdout` and `stderr` are undefined unless piped.
function summary(result: Bun.SyncSubprocess<any, any>) {
  return {
    exitCode: result.exitCode,
    signalCode: result.signalCode,
    success: result.success,
    exitedDueToTimeout: result.exitedDueToTimeout,
    exitedDueToMaxBuffer: result.exitedDueToMaxBuffer,
    stdout: result.stdout?.toString(),
    stderr: result.stderr?.toString(),
  };
}

describe("spawnSync", () => {
  it("should throw a RangeError if timeout is less than 0", () => {
    expect(() =>
      Bun.spawnSync({
        cmd: [bunExe()],
        env: bunEnv,
        timeout: -1,
      }),
    ).toThrow(
      expect.objectContaining({
        name: "RangeError",
        code: "ERR_OUT_OF_RANGE",
        message: 'The value of "timeout" is out of range. It must be >= 0 and <= 9007199254740991. Received -1',
      }),
    );
  });

  // The child outlives a 0 ms timeout, and when piped it also writes bytes
  // that a 0 byte maxBuffer would reject. Either limit wrongly applied would
  // kill it. With "inherit" the child writes nothing, to keep the test output clean.
  for (const ioOption of ["ignore", "pipe", "inherit"] as const) {
    const output = ioOption === "inherit" ? "" : "hi";
    const child = isWindows
      ? [bunExe(), "-e", `process.stdout.write(${JSON.stringify(output)}); setTimeout(() => {}, 50)`]
      : ["/bin/sh", "-c", `printf '${output}'; sleep 0.05`];
    it(`should not set a timeout or maxBuffer if both are 0 and ${ioOption} is used for stdout`, () => {
      const result = Bun.spawnSync({
        cmd: child,
        env: bunEnv,
        stdin: "ignore",
        stdout: ioOption,
        stderr: ioOption,
        timeout: 0,
        maxBuffer: 0,
      });
      expect(summary(result)).toEqual({
        exitCode: 0,
        signalCode: undefined,
        success: true,
        exitedDueToTimeout: undefined,
        exitedDueToMaxBuffer: undefined,
        stdout: ioOption === "pipe" ? "hi" : undefined,
        stderr: ioOption === "pipe" ? "" : undefined,
      });
    });
  }

  // https://github.com/oven-sh/bun/issues/33932
  // Windows-only: the timeout timer lives on a cached libuv loop whose clock
  // freezes between calls; the POSIX path compares against the real clock.
  it.skipIf(!isWindows)("timeout is measured from the current call, not from the previous spawnSync", async () => {
    const echo = (s: string) => ["cmd", "/c", `echo ${s}`];
    // Populate the cached isolated event loop, then let its clock go stale
    // for longer than the next call's timeout.
    const first = Bun.spawnSync({ cmd: echo("first"), stdout: "pipe", stderr: "pipe" });
    expect(first.exitCode).toBe(0);

    await Bun.sleep(2000);

    const result = Bun.spawnSync({ cmd: echo("ok"), stdout: "pipe", stderr: "pipe", timeout: 1500 });
    expect({
      stdout: result.stdout.toString().trim(),
      exitedDueToTimeout: result.exitedDueToTimeout,
      exitCode: result.exitCode,
    }).toEqual({ stdout: "ok", exitedDueToTimeout: false, exitCode: 0 });
  });

  // With no pipes, spawnSync blocks in waitpid instead of running its event
  // loop. Where memfd is compiled in (Linux and Android, see can_use_memfd in
  // src/runtime/api/bun/spawn/stdio.rs) a buffer stdin becomes a memfd, which
  // keeps that fast path. Elsewhere the buffer goes through a pipe on the event
  // loop, so neither counter moves.
  it.skipIf(!isPosix)("should use the blocking fast path, and memfd for a buffer stdin on Linux", async () => {
    const { stdout, stderr, exitCode, signalCode } = await bunRun(
      join(import.meta.dir, "spawnSync-counters-fixture.ts"),
    );
    expect({ counters: JSON.parse(stdout || "null"), stderr, exitCode, signalCode }).toEqual({
      counters: {
        inherit: { exitCode: 0, spawnSync_blocking: 1, spawn_memfd: 0 },
        bufferStdin:
          isLinux || isAndroid
            ? { exitCode: 0, spawnSync_blocking: 1, spawn_memfd: 1 }
            : { exitCode: 0, spawnSync_blocking: 0, spawn_memfd: 0 },
      },
      stderr: "",
      exitCode: 0,
      signalCode: null,
    });
  });

  describe.skipIf(!isPosix)("drains piped stdio to EOF after the direct child exits", () => {
    // The grandchild inherits the stdio and writes to both fds after the direct
    // child has exited. The first pause lets spawnSync see the exit before more
    // output arrives; the second keeps B and C in separate reads.
    const cmd = [
      "/bin/sh",
      "-c",
      "printf A; printf a >&2; ( sleep 0.1; printf B; printf b >&2; sleep 0.05; printf C; printf c >&2 ) & exit 0",
    ];
    const layouts: [string, "pipe" | "ignore", "pipe" | "ignore"][] = [
      ["stdout", "pipe", "ignore"],
      ["stderr", "ignore", "pipe"],
      ["stdout and stderr", "pipe", "pipe"],
    ];
    for (const [piped, stdout, stderr] of layouts) {
      for (const maxBuffer of [undefined, 1024 * 1024]) {
        it(`${piped} (maxBuffer=${maxBuffer})`, () => {
          const result = Bun.spawnSync({ cmd, stdio: ["ignore", stdout, stderr], maxBuffer });
          expect(summary(result)).toEqual({
            exitCode: 0,
            signalCode: undefined,
            success: true,
            exitedDueToTimeout: undefined,
            exitedDueToMaxBuffer: maxBuffer === undefined ? undefined : false,
            stdout: stdout === "pipe" ? "ABC" : undefined,
            stderr: stderr === "pipe" ? "abc" : undefined,
          });
        });
      }
    }

    it("timeout still bounds the wait when a grandchild never closes the pipe", () => {
      const result = Bun.spawnSync({
        cmd: ["/bin/sh", "-c", "printf A; sleep 5 & exit 0"],
        stdio: ["ignore", "pipe", "ignore"],
        timeout: 500,
      });
      // The direct child exited 0 on its own. The grandchild holds the pipe
      // open and writes nothing, so the timeout must end the wait.
      expect(summary(result)).toEqual({
        exitCode: 0,
        signalCode: undefined,
        success: true,
        exitedDueToTimeout: true,
        exitedDueToMaxBuffer: undefined,
        stdout: "A",
        stderr: undefined,
      });
    });
  });

  // The result object is created from native code. It used to get a structure
  // with zero inline capacity, which trips ASSERT(hasInlineStorage()) in JSC's
  // object spread fast path on debug builds.
  it("result object can be spread", async () => {
    const fixture = `
      const result = Bun.spawnSync({ cmd: [process.execPath, "--version"] });
      const copy = { ...result };
      console.log(JSON.stringify({ success: copy.success, exitCode: copy.exitCode, pid: copy.pid === result.pid }));
    `;
    await using proc = Bun.spawn({ cmd: [bunExe(), "-e", fixture], env: bunEnv, stdout: "pipe", stderr: "pipe" });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect({ stdout: stdout.trim(), stderr, exitCode }).toEqual({
      stdout: '{"success":true,"exitCode":0,"pid":true}',
      stderr: "",
      exitCode: 0,
    });
  });
});

const GiB = 1024 ** 3;
// os.totalmem() is the host's memory. Inside a container with a cgroup memory
// limit, process.constrainedMemory() is that limit.
const memoryBudget = Math.min(totalmem(), process.constrainedMemory());

// A Buffer holds at most kMaxLength (2^32) bytes. spawnSync hands the captured
// output to JSC without a copy, and a larger output used to kill the process at
// that hand-off instead of throwing the RangeError an allocation of that size
// throws. An output of exactly 2^32 bytes used to die in a length cast on the
// same path. Each case makes the child hold 4 GiB of zeros (the read buffer
// doubles to 8 GiB on the way, for a peak RSS near 8.5 GiB), so the cases run
// in a child process, only on machines with room, and the child has its own
// timeout so that the memory is reclaimed even when the test times out.
// Most of the time goes to page faults in that child, so the two cases run at
// the same time when there is room for both.
const describeAtLimit = memoryBudget >= 32 * GiB ? describe.concurrent : describe;
describeAtLimit.skipIf(!isPosix || memoryBudget < 16 * GiB)("spawnSync output at the Buffer length limit", () => {
  async function captureZeros(size: number) {
    await using proc = Bun.spawn({
      cmd: [
        bunExe(),
        "-e",
        `
        let result;
        try {
          const { stdout, exitCode } = Bun.spawnSync({
            cmd: ["head", "-c", ${JSON.stringify(String(size))}, "/dev/zero"],
            stdout: "pipe",
            stderr: "pipe",
          });
          result = { isBuffer: Buffer.isBuffer(stdout), length: stdout.length, lastByte: stdout[stdout.length - 1], exitCode };
        } catch (e) {
          result = { isRangeError: e instanceof RangeError, message: e.message };
        }
        console.log(JSON.stringify(result));
        `,
      ],
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
      // Under the 120 s test timeout below. A child that is still running then
      // shows up as signalCode "SIGKILL" instead of living on after the test.
      timeout: 100_000,
      killSignal: "SIGKILL",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    return { result: JSON.parse(stdout.trim() || "null"), stderr, exitCode, signalCode: proc.signalCode };
  }

  it("an output of 2^32 + 1 bytes throws the RangeError that new ArrayBuffer(2 ** 32 + 1) throws", async () => {
    expect(await captureZeros(2 ** 32 + 1)).toEqual({
      result: { isRangeError: true, message: "Out of memory" },
      stderr: "",
      exitCode: 0,
      signalCode: null,
    });
  }, 120_000);

  it("an output of exactly 2^32 bytes is returned whole", async () => {
    expect(await captureZeros(2 ** 32)).toEqual({
      result: { isBuffer: true, length: 2 ** 32, lastByte: 0, exitCode: 0 },
      stderr: "",
      exitCode: 0,
      signalCode: null,
    });
  }, 120_000);
});

describe("uid/gid", () => {
  const isRoot = process.getuid?.() === 0;

  it("rejects a non-integer uid", () => {
    expect(() => Bun.spawnSync({ cmd: [bunExe()], env: bunEnv, uid: 1.5 })).toThrow();
    expect(() => Bun.spawnSync({ cmd: [bunExe()], env: bunEnv, gid: 1.5 })).toThrow();
  });

  it.if(isPosix && isRoot)("applies uid/gid and drops supplementary groups", () => {
    const result = Bun.spawnSync({ cmd: ["id"], uid: 65534, gid: 65534 });
    const out = result.stdout.toString();
    expect(out).toContain("uid=65534");
    expect(out).toContain("gid=65534");
    expect(result.exitCode).toBe(0);

    const groups = Bun.spawnSync({ cmd: ["id", "-G"], uid: 65534, gid: 65534 });
    expect(groups.stdout.toString().trim()).toBe("65534");
  });

  // The vfork child shares the parent's mm, and set*id resets the mm-wide
  // "dumpable" flag (prctl(2)); the spawn must restore it in the parent.
  it.if(isLinux && isRoot)("does not clear the parent's dumpable flag", async () => {
    const libc = isMusl ? (process.arch === "arm64" ? "libc.musl-aarch64.so.1" : "libc.musl-x86_64.so.1") : "libc.so.6";
    const fixture = `
      const { dlopen, FFIType } = require("bun:ffi");
      const { prctl } = dlopen(${JSON.stringify(libc)}, {
        prctl: { args: [FFIType.i32, FFIType.u64, FFIType.u64, FFIType.u64, FFIType.u64], returns: FFIType.i32 },
      }).symbols;
      const PR_GET_DUMPABLE = 3;
      const before = prctl(PR_GET_DUMPABLE, 0, 0, 0, 0);
      const child = Bun.spawnSync({ cmd: ["id", "-u"], uid: 65534, gid: 65534 });
      const after = prctl(PR_GET_DUMPABLE, 0, 0, 0, 0);
      console.log(JSON.stringify({ before, after, childUid: child.stdout.toString().trim() }));
    `;
    await using proc = Bun.spawn({ cmd: [bunExe(), "-e", fixture], env: bunEnv, stdout: "pipe", stderr: "pipe" });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect({ result: JSON.parse(stdout), exitCode }).toEqual({
      result: { before: 1, after: 1, childUid: "65534" },
      exitCode: 0,
    });
  });

  it.if(isPosix && !isRoot)("throws EPERM for a uid the process cannot set", () => {
    let thrown: any;
    try {
      Bun.spawnSync({ cmd: ["id"], uid: 0 });
    } catch (e) {
      thrown = e;
    }
    expect(thrown?.code).toBe("EPERM");
  });
});
