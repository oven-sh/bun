import { describe, expect, it } from "bun:test";
import { existsSync } from "fs";
import { bunEnv, bunExe, bunRun, isLinux, isMusl, isPosix, isRoot, isWindows, tempDir } from "harness";
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

  for (const ioOption of ["ignore", "pipe", "inherit"] as const) {
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

// The result of Bun.spawnSync has no place for what a child writes to a stdio pipe above stderr, and a child that
// fills a pipe nobody reads never exits. So the call reads the pipe for as long as it waits for the child, and keeps
// none of the bytes.
describe("a pipe at stdio index >= 3", () => {
  // Writes more to fd 3 than a pipe holds on any platform, then "done" to stdout.
  const writer = `
    const fs = require("node:fs");
    const chunk = Buffer.alloc(1_000_000, 97);
    for (let written = 0; written < chunk.length; ) written += fs.writeSync(3, chunk, written);
    fs.writeSync(1, "done");
  `;
  const cmd = [bunExe(), "-e", writer];
  const summary = (r: Bun.SyncSubprocess<"pipe", "pipe">) => ({
    exitCode: r.exitCode,
    signalCode: r.signalCode,
    stdout: r.stdout.toString(),
    stderr: r.stderr.toString(),
  });
  const done = { exitCode: 0, signalCode: undefined, stdout: "done", stderr: "" };

  it("the call returns when the child writes more than the pipe holds", () => {
    expect(summary(Bun.spawnSync({ cmd, stdio: ["ignore", "pipe", "pipe", "pipe"], env: bunEnv }))).toEqual(done);
    expect(summary(Bun.spawnSync(cmd, { stdio: ["ignore", "pipe", "pipe", "pipe"], env: bunEnv }))).toEqual(done);
  });

  it("an 'ipc' entry is a pipe like any other", () => {
    const stdio = ["ignore", "pipe", "pipe", "ipc"] as any;
    expect(summary(Bun.spawnSync({ cmd, stdio, env: bunEnv }))).toEqual(done);
  });

  it("maxBuffer does not count the pipe", () => {
    const result = Bun.spawnSync({ cmd, stdio: ["ignore", "pipe", "pipe", "pipe"], env: bunEnv, maxBuffer: 1000 });
    expect({ ...summary(result), exitedDueToMaxBuffer: result.exitedDueToMaxBuffer }).toEqual({
      ...done,
      exitedDueToMaxBuffer: false,
    });
  });

  it("the call does not wait for a descendant that keeps the pipe open", async () => {
    using dir = tempDir("spawn-sync-pipe-descendant", {});
    const broken = join(String(dir), "broken");
    // The descendant writes to the pipe until the call has closed its end of it, and then says so.
    const descendant = `
      const fs = require("node:fs");
      try {
        for (;;) fs.writeSync(3, "late");
      } catch {}
      fs.writeFileSync(process.env.BROKEN, "");
    `;
    const child = `
      Bun.spawn({
        cmd: [process.execPath, "-e", process.env.DESCENDANT],
        stdio: ["ignore", "ignore", "ignore", 3],
        detached: true,
      }).unref();
      ${writer}
      process.exit(0);
    `;
    const result = Bun.spawnSync({
      cmd: [bunExe(), "-e", child],
      stdio: ["ignore", "pipe", "pipe", "pipe"],
      // The CI runner sets BUN_FEATURE_FLAG_NO_ORPHANS on ASAN lanes, which makes the child kill the descendant
      // when it exits. This test needs the descendant to outlive the child and hold the pipe open.
      env: { ...bunEnv, DESCENDANT: descendant, BROKEN: broken, BUN_FEATURE_FLAG_NO_ORPHANS: undefined },
    });
    expect(summary(result)).toEqual(done);
    // The call has closed its end: the next write of the descendant fails.
    while (!existsSync(broken)) await Bun.sleep(1);
  });

  // A Buffer at stdin is a memfd on Linux, which the child reads with no writer in the parent. Without memfd the
  // call writes stdin through a pipe, as on macOS and Windows, while it reads the pipe above stderr.
  it.skipIf(!isLinux)("the call writes stdin through a pipe while it reads the pipe above stderr", async () => {
    const fixture = `
      const { spawnSync } = require("node:child_process");
      const input = Buffer.alloc(2_000_000, "i");
      // Copies stdin to fd 3, then writes how many bytes that was to stdout.
      const copy = \`
        const fs = require("node:fs");
        const chunk = Buffer.alloc(65536);
        let total = 0;
        for (let n; (n = fs.readSync(0, chunk)) > 0; total += n) {
          for (let at = 0; at < n; ) at += fs.writeSync(3, chunk, at, n - at);
        }
        fs.writeSync(1, String(total));
      \`;
      const cmd = [process.execPath, "-e", copy];
      const dropped = Bun.spawnSync({ cmd, stdio: [input, "pipe", "inherit", "pipe"] });
      const returned = spawnSync(cmd[0], cmd.slice(1), {
        input,
        stdio: ["pipe", "pipe", "inherit", "pipe"],
        maxBuffer: 2 * input.length,
      });
      console.log(
        JSON.stringify({
          dropped: { exitCode: dropped.exitCode, copied: dropped.stdout.toString() },
          returned: {
            status: returned.status,
            error: returned.error?.code,
            copied: returned.output[1].toString(),
            intact: input.equals(returned.output[3]),
          },
        }),
      );
    `;
    await using proc = Bun.spawn({
      cmd: [bunExe(), "-e", fixture],
      env: { ...bunEnv, BUN_FEATURE_FLAG_DISABLE_MEMFD: "1" },
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect({ stderr, exitCode }).toEqual({ stderr: "", exitCode: 0 });
    expect(JSON.parse(stdout)).toEqual({
      dropped: { exitCode: 0, copied: "2000000" },
      returned: { status: 0, copied: "2000000", intact: true },
    });
  });

  // A reader that takes all there is before it lets go of the bytes holds most of what this child writes: the
  // child refills the pipe faster than the reader empties it.
  const cc = Bun.which("cc") || Bun.which("gcc") || Bun.which("clang");
  it.skipIf(!isLinux || !cc)("the call keeps none of what a child floods the pipe with", async () => {
    const megabytes = 256;
    using dir = tempDir("spawn-sync-pipe-flood", {
      // Writes argv[1] MiB to fd 3 and never blocks: a write that finds the pipe full is tried again at once.
      "flood.c": `
        #include <errno.h>
        #include <fcntl.h>
        #include <stdlib.h>
        #include <unistd.h>

        int main(int argc, char **argv) {
          static char chunk[1 << 20];
          long left = atol(argv[1]) << 20;
          // With nobody to read the pipe this loop has no end.
          alarm(60);
          fcntl(3, F_SETFL, fcntl(3, F_GETFL) | O_NONBLOCK);
          while (left > 0) {
            ssize_t n = write(3, chunk, left < (long)sizeof chunk ? (size_t)left : sizeof chunk);
            if (n > 0) left -= n;
            else if (errno != EAGAIN && errno != EINTR) return 1;
          }
          return 0;
        }
      `,
      "flood-fixture.js": `
        const fs = require("node:fs");
        // The peak resident set of this process. ru_maxrss is no use here: it survives exec, so it starts at
        // the peak of the test runner.
        const peak = () => Number(/VmHWM:\\s+(\\d+) kB/.exec(fs.readFileSync("/proc/self/status", "utf8"))[1]);
        const flood = megabytes =>
          Bun.spawnSync({ cmd: ["./flood", String(megabytes)], stdio: ["ignore", "ignore", "inherit", "pipe"] });
        // The first call pays for what every call after it uses again.
        flood(1);
        const before = peak();
        const { exitCode } = flood(${megabytes});
        console.log(JSON.stringify({ exitCode, grewMiB: Math.round((peak() - before) / 1024) }));
      `,
    });
    await using compile = Bun.spawn({
      cmd: [cc!, "-O2", "-o", "flood", "flood.c"],
      cwd: String(dir),
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });
    const [compileErrors, compiled] = await Promise.all([compile.stderr.text(), compile.exited]);
    if (compiled !== 0) throw new Error(`flood.c does not compile: ${compileErrors}`);

    await using proc = Bun.spawn({
      cmd: [bunExe(), "flood-fixture.js"],
      cwd: String(dir),
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect({ stderr, exitCode }).toEqual({ stderr: "", exitCode: 0 });
    const result = JSON.parse(stdout);
    expect(result.exitCode).toBe(0);
    // The call keeps none of the bytes: it holds one read buffer of 256 KiB at most.
    expect(result.grewMiB).toBeLessThan(32);
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

it("a test timeout doesn't kill the child of a spawnSync running in a Worker", async () => {
  // The child is told to stop right after the deadline and then sleeps 200 ms, so a signal sent at the deadline
  // would kill it first.
  const untilStopped = `
    for (let i = 0; i < 2000 && !require("node:fs").existsSync("stop"); i++) Bun.sleepSync(5);
    Bun.sleepSync(200);
  `;
  using dir = tempDir("spawnsync-worker-test-timeout", {
    "timeout.test.ts": `
      import { afterAll, expect, test } from "bun:test";
      import { writeFileSync } from "node:fs";

      const worker = new Worker(new URL("worker.ts", import.meta.url).href);
      afterAll(() => worker.terminate());
      const ended = new Promise(resolve => {
        worker.onmessage = event => resolve(event.data);
      });

      test("times out", async () => {
        await new Promise(() => {});
      }, 1000);

      test("the worker's child exited on its own", async () => {
        writeFileSync("stop", "");
        expect(await ended).toEqual({ exitCode: 0, signalCode: null });
      });
    `,
    // With a pipe, spawnSync waits in its own event loop, which checks bun:test's deadlines.
    "worker.ts": `
      const { exitCode, signalCode = null } = Bun.spawnSync({
        cmd: [process.execPath, "-e", ${JSON.stringify(untilStopped)}],
        stdin: "ignore",
        stdout: "pipe",
        stderr: "ignore",
      });
      postMessage({ exitCode, signalCode });
    `,
  });
  await using proc = Bun.spawn({
    cmd: [bunExe(), "test", "timeout.test.ts"],
    env: bunEnv,
    cwd: String(dir),
    stdin: "ignore",
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  expect(stdout + stderr).toContain("(pass) the worker's child exited on its own");
  expect(exitCode).toBe(1);
});

describe("uid/gid", () => {
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

// A writer that is finalized while spawnSync waits has to leave the epoll it registered with. Its EPOLL_CTL_DEL went to
// the loop spawnSync waits on, and the kernel keeps an entry for as long as the open file lives, which for a dup of
// stderr is the whole process: the next dup to get that number failed to register with EEXIST.
// BUN_JSC_slowPathAllocsBetweenGCs collects every few slow-path allocations. maxBuffer is the last option spawnSync
// reads, so the collection that follows the drop runs once it is past them. Bun.gc() leaves every free list empty,
// so what it allocates from there on takes the slow path, whatever ran before.
it.skipIf(!isLinux)("a writer finalized during spawnSync leaves its fd number usable", async () => {
  await using proc = Bun.spawn({
    cmd: [
      bunExe(),
      "-e",
      `
      // On globalThis: a binding that is only written after the await is dead across it.
      globalThis.writers = [];
      const refs = [];
      for (let i = 0; i < 4; i++) {
        const writer = Bun.file(2).writer();
        writer.write("");
        globalThis.writers.push(writer);
        refs.push(new WeakRef(writer));
      }
      // A WeakRef keeps its target alive until the job that made it ends.
      await Bun.sleep(0);
      // Through a child: loading node:fs under that GC setting takes a debug build many seconds.
      const list = { cmd: ["ls", "-l", "/proc/" + process.pid + "/fd"], stdout: "pipe", stderr: "ignore" };
      const dupsOfStderr = ({ stdout }) => {
        const links = stdout.toString().split("\\n").map(line => line.match(/ (\\d+) -> (.+)$/)).filter(Boolean);
        const stderr = links.find(([, fd]) => fd === "2")[2];
        return links.filter(([, fd, target]) => fd !== "2" && target === stderr).length;
      };
      const heldBeforeCall = dupsOfStderr(Bun.spawnSync(list));
      let listing = Bun.spawnSync({ ...list, get maxBuffer() { Bun.gc(true); globalThis.writers = null; } });
      let collectedDuringCall = 0;
      for (const ref of refs) if (ref.deref() === undefined) collectedDuringCall++;
      // The fds are closed on the work pool. Once they are, dup() hands their numbers out again.
      const deadline = performance.now() + 3000;
      while (dupsOfStderr(listing) > 0 && performance.now() < deadline) listing = Bun.spawnSync(list);
      const stillOpen = dupsOfStderr(listing);
      const writer = Bun.file(2).writer();
      writer.write("registered");
      writer.flush();
      console.log(JSON.stringify({ heldBeforeCall, collectedDuringCall, stillOpen }));
    `,
    ],
    env: { ...bunEnv, BUN_JSC_slowPathAllocsBetweenGCs: "3" },
    stdout: "pipe",
    stderr: "pipe", // pollable, so a writer registers its dup
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  expect({ stdout: stdout.trim(), stderr, exitCode }).toEqual({
    stdout: JSON.stringify({ heldBeforeCall: 4, collectedDuringCall: 4, stillOpen: 0 }),
    stderr: "registered",
    exitCode: 0,
  });
});
