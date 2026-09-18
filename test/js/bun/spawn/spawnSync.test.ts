import { describe, expect, it, test } from "bun:test";
import { bunEnv, bunExe, bunRun, isLinux, isMusl, isPosix, isWindows, tempDir } from "harness";
import { totalmem } from "os";
import { join } from "path";
describe("spawnSync", () => {
  it("should throw a RangeError if timeout is less than 0", () => {
    expect(() =>
      Bun.spawnSync({
        cmd: [bunExe()],
        env: bunEnv,
        timeout: -1,
      }),
    ).toThrowErrorMatchingInlineSnapshot(
      `"The value of "timeout" is out of range. It must be >= 0 and <= 9007199254740991. Received -1"`,
    );
  });

  for (const ioOption of ["ignore", "pipe", "inherit"]) {
    it(`should not set a timeout if timeout is 0 and ${ioOption} is used for stdout`, () => {
      const start = performance.now();
      const result = Bun.spawnSync({
        cmd: [bunExe(), "-e", "setTimeout(() => {}, 5)"],
        env: bunEnv,
        stdin: "ignore",
        stdout: ioOption,
        stderr: ioOption,
        timeout: 0,
        maxBuffer: 0,
      });
      const end = performance.now();
      expect(end - start).toBeLessThan(1000);
      expect(!!result.exitedDueToTimeout).toBe(false);
      expect(result.exitCode).toBe(0);
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

  it.skipIf(process.platform !== "linux")("should use memfd when possible", async () => {
    expect(await bunRun(join(import.meta.dir, "spawnSync-memfd-fixture.ts"))).toSpawn();
  });

  it.skipIf(!isPosix)("should use spawnSync optimizations when possible", async () => {
    expect(await bunRun(join(import.meta.dir, "spawnSync-counters-fixture.ts"))).toSpawn();
  });

  describe.skipIf(!isPosix)("drains piped stdio to EOF after the direct child exits", () => {
    // Grandchild inherits the pipe and writes after the direct child has exited.
    const sh = (fd: number) => [
      "/bin/sh",
      "-c",
      `printf A >&${fd}; ( sleep 0.3; printf B >&${fd}; sleep 0.1; printf C >&${fd} ) & exit 0`,
    ];
    for (const maxBuffer of [undefined, 1024 * 1024]) {
      it(`stdout (maxBuffer=${maxBuffer})`, () => {
        const { stdout, exitCode } = Bun.spawnSync({
          cmd: sh(1),
          stdio: ["ignore", "pipe", "ignore"],
          maxBuffer,
        });
        expect({ stdout: stdout.toString(), exitCode }).toEqual({ stdout: "ABC", exitCode: 0 });
      });
      it(`stderr (maxBuffer=${maxBuffer})`, () => {
        const { stderr, exitCode } = Bun.spawnSync({
          cmd: sh(2),
          stdio: ["ignore", "ignore", "pipe"],
          maxBuffer,
        });
        expect({ stderr: stderr.toString(), exitCode }).toEqual({ stderr: "ABC", exitCode: 0 });
      });
    }

    it("timeout still bounds the wait when a grandchild never closes the pipe", () => {
      const { stdout, exitedDueToTimeout } = Bun.spawnSync({
        cmd: ["/bin/sh", "-c", "printf A; sleep 5 & exit 0"],
        stdio: ["ignore", "pipe", "ignore"],
        timeout: 500,
      });
      // The grandchild holds the pipe open and writes nothing; timeout must fire.
      expect({ stdout: stdout.toString(), exitedDueToTimeout }).toEqual({ stdout: "A", exitedDueToTimeout: true });
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

// A Buffer holds at most kMaxLength (2^32) bytes. spawnSync hands the captured
// output to JSC without a copy, and a larger output used to kill the process at
// that hand-off instead of throwing the RangeError an allocation of that size
// throws. An output of exactly 2^32 bytes used to die in a length cast on the
// same path. Each case makes the child hold 4 GiB of zeros (the read buffer
// doubles to 8 GiB on the way), so the cases run one at a time, in a child
// process, with a long timeout, and only on machines with room.
describe.skipIf(!isPosix || totalmem() < 16 * 1024 ** 3)("spawnSync output at the Buffer length limit", () => {
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
          result = { isBuffer: Buffer.isBuffer(stdout), length: stdout.length, exitCode };
        } catch (e) {
          result = { isRangeError: e instanceof RangeError, message: e.message };
        }
        console.log(JSON.stringify(result));
        `,
      ],
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
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
      result: { isBuffer: true, length: 2 ** 32, exitCode: 0 },
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

// spawnSync points the VM's loop handle at its private loop for the whole
// call. A FilePoll torn down inside that window (here: the GC finalizing a
// garbage `Bun.file(2).writer()` while spawnSync builds its result) must
// still unregister from the loop it was registered with. Before the fix the
// EPOLL_CTL_DEL went to the private loop, so the main loop kept a stale
// entry for the dup'd fd number. The next `Bun.file(2).writer()` dups to the
// same number, EPOLL_CTL_ADD fails with EEXIST, and the fd is closed twice:
// once by FileSink::setup and once by the writer's Drop through the Closer.
test.skipIf(!isLinux)("a writer finalized during spawnSync does not break the next writer on the same fd", async () => {
  // A file, not `-e`: run through `-e`, the collection that `Bun.gc(false)`
  // requests does not finalize the writers inside spawnSync (their dups stay
  // open for the whole wait), and the test no longer reaches the bug.
  using dir = tempDir("spawnsync-writer-finalized", {
    "fixture.js": `
      import { fstatSync, readdirSync } from "node:fs";
      const stderrInode = fstatSync(2).ino;
      // Every writer holds a dup() of fd 2; those share stderr's inode.
      const stderrDups = () =>
        readdirSync("/proc/self/fd")
          .map(Number)
          .filter(fd => {
            if (fd === 2) return false;
            try {
              return fstatSync(fd).ino === stderrInode;
            } catch {
              return false;
            }
          });
      function leakWriter() {
        const w = Bun.file(2).writer();
        w.write("");
      }
      for (let i = 0; i < 4; i++) leakWriter();
      const dups = stderrDups().length;
      // The collector finishes inside spawnSync: the first JS allocation after
      // the wait (the result object) is where the mutator runs the sweep.
      Bun.gc(false);
      const r = Bun.spawnSync({ cmd: ["sleep", "0.2"] });
      // The finalized writers close their fds on the work pool; wait for that so
      // dup(2) below hands out one of the same numbers.
      const deadline = Date.now() + 5000;
      while (Date.now() < deadline && stderrDups().length > 0) Bun.sleepSync(5);
      const remaining = stderrDups().length;
      const w = Bun.file(2).writer();
      w.write("second writer ok\\n");
      w.flush();
      console.log(JSON.stringify({ exitCode: r.exitCode, dups, remaining }));
    `,
  });
  await using proc = Bun.spawn({
    cmd: [bunExe(), "fixture.js"],
    env: bunEnv,
    cwd: String(dir),
    stdout: "pipe",
    // A pipe is pollable, so the writers register their dup of fd 2 with epoll.
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  expect({ stdout, stderr, exitCode }).toEqual({
    stdout: JSON.stringify({ exitCode: 0, dups: 4, remaining: 0 }) + "\n",
    stderr: "second writer ok\n",
    exitCode: 0,
  });
});
