import { describe, expect, it } from "bun:test";
import { bunEnv, bunExe, bunRun, isASAN, isDebug, isLinux, isMusl, isPosix, isRoot, isWindows, tempDir } from "harness";
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

// In `bun test`, the deadline of a test ends a spawnSync wait: the child is sent its kill signal and its pipes are
// closed. When no test callback is on the stack, as after an `await`, the runner does not know which test of a group
// of concurrent tests called spawnSync, so the wait ends at the latest deadline of the tests that are running. "No
// timeout" ranked below every deadline there, and the timeout of one test ended the child of a test that has none.
//
// One case at a time on debug and ASAN builds: their processes start slowly. Five cases at once took 3.7 s of the 5 s
// each has on a debug build.
(isDebug || isASAN ? describe : describe.concurrent)("spawnSync after an await in a group of concurrent tests", () => {
  // Each defines `childRanToItsEnd(cmd)`.
  const entryPoints = {
    "Bun.spawnSync": /* ts */ `
      const childRanToItsEnd = (cmd: string[]) =>
        Bun.spawnSync({ cmd, stdin: "ignore", stdout: "ignore", stderr: "ignore" }).exitCode === 0;
    `,
    "child_process.spawnSync": /* ts */ `
      import { spawnSync } from "node:child_process";
      const childRanToItsEnd = (cmd: string[]) => spawnSync(cmd[0], cmd.slice(1), { stdio: "ignore" }).status === 0;
    `,
    "child_process.execFileSync": /* ts */ `
      import { execFileSync } from "node:child_process";
      const childRanToItsEnd = (cmd: string[]) => returns(() => execFileSync(cmd[0], cmd.slice(1), { stdio: "ignore" }));
    `,
    "child_process.execSync": /* ts */ `
      import { execSync } from "node:child_process";
      const childRanToItsEnd = (cmd: string[]) =>
        returns(() => execSync('"' + cmd[0] + '" ' + cmd.slice(1).join(" "), { stdio: "ignore" }));
    `,
  };

  async function runGroup(
    tests: string,
    { entryPoint = "Bun.spawnSync", args = [] }: { entryPoint?: keyof typeof entryPoints; args?: string[] } = {},
  ) {
    using dir = tempDir("spawnsync-concurrent-group", {
      // Its parent waits in spawnSync, so nothing can tell it that a deadline has passed: it runs for a fixed time.
      "child.js": `Bun.sleepSync(Number(process.argv[2]));`,
      "group.test.ts": /* ts */ `
        import { expect, test } from "bun:test";

        // The sync functions of node:child_process throw when the child does not exit with 0.
        function returns(fn: () => unknown) {
          try {
            fn();
            return true;
          } catch {
            return false;
          }
        }
        ${entryPoints[entryPoint]}

        // 300 ms is past every 100 ms timeout below, and 4000 ms is past every timeout.
        function waitForChild(ms: 300 | 4000) {
          const finished = childRanToItsEnd([process.execPath, "child.js", String(ms)]);
          console.log(finished ? "the child finished" : "the child was ended early");
          return finished;
        }
        const immediate = () => new Promise(resolve => setImmediate(resolve));
        const never = new Promise(() => {});
        ${tests}
      `,
    });
    await using proc = Bun.spawn({
      cmd: [bunExe(), "test", ...args, "group.test.ts"],
      env: bunEnv,
      cwd: String(dir),
      stdin: "ignore",
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    return {
      child: stdout.split(/\r?\n/).filter(line => line.startsWith("the child")),
      // A test that takes no time has no duration after its name.
      tests: stderr
        .split(/\r?\n/)
        .map(line => line.match(/^\((pass|fail)\) (.+?)(?: \[[\d.]+ms\])?$/))
        .filter(match => match !== null)
        .map(([, result, name]) => `${name}: ${result}`)
        .sort(),
      exitCode,
    };
  }

  it.each(Object.keys(entryPoints) as (keyof typeof entryPoints)[])(
    "%s: the timeout of a sibling does not end the child of a test with no timeout",
    async entryPoint => {
      const group = await runGroup(
        `
          test.concurrent("times out", async () => {
            await never;
          }, 100);

          test.concurrent("has no timeout", async () => {
            await immediate();
            expect(waitForChild(300)).toBe(true);
          }, 0);
        `,
        { entryPoint },
      );

      expect(group).toEqual({
        child: ["the child finished"],
        tests: ["has no timeout: pass", "times out: fail"],
        exitCode: 1,
      });
    },
  );

  // The sibling passes when it is tried again, so the signal alone made this run fail.
  it("a sibling that times out once does not fail a test with no timeout", async () => {
    const group = await runGroup(`
      let attempts = 0;

      test.concurrent("times out once", async () => {
        if (attempts++ === 0) await never;
      }, { retry: 1, timeout: 100 });

      test.concurrent("has no timeout", async () => {
        await immediate();
        expect(waitForChild(300)).toBe(true);
      }, 0);
    `);

    expect(group).toEqual({
      child: ["the child finished"],
      tests: ["has no timeout: pass", "times out once (attempt 2): pass"],
      exitCode: 0,
    });
  });

  // The wait loop closes the pipes when it signals the child. This shell has exited by then, so the deadline of the
  // sibling showed only as cut output, with exit code 0.
  it.skipIf(isWindows)("the timeout of a sibling does not cut the output of a test with no timeout", async () => {
    const group = await runGroup(`
      test.concurrent("times out", async () => {
        await never;
      }, 100);

      test.concurrent("has no timeout", async () => {
        await immediate();
        const { stdout, exitCode } = Bun.spawnSync({
          cmd: ["sh", "-c", "(sleep 0.3; echo late) & echo early"],
          stdin: "ignore",
          stdout: "pipe",
          stderr: "ignore",
        });
        console.log("the child wrote " + JSON.stringify(stdout.toString()) + " and exited with " + exitCode);
      }, 0);
    `);

    expect(group).toEqual({
      child: [`the child wrote "early\\nlate\\n" and exited with 0`],
      tests: ["has no timeout: pass", "times out: fail"],
      exitCode: 1,
    });
  });

  it("the latest timeout ends the child when every test that runs has one", async () => {
    const group = await runGroup(`
      test.concurrent("times out first", async () => {
        await never;
      }, 100);

      test.concurrent("times out last", async () => {
        await immediate();
        waitForChild(4000);
      }, 300);
    `);

    expect(group).toEqual({
      child: ["the child was ended early"],
      tests: ["times out first: fail", "times out last: fail"],
      exitCode: 1,
    });
  });

  // Its deadline is not set before it starts. That is not "no timeout".
  it("a test that has not started does not keep the child of a test that times out", async () => {
    const group = await runGroup(
      `
        test.concurrent("times out", async () => {
          await immediate();
          waitForChild(4000);
        }, 300);

        test.concurrent("has not started", () => {}, 0);
      `,
      { args: ["--max-concurrency", "1"] },
    );

    expect(group).toEqual({
      child: ["the child was ended early"],
      tests: ["has not started: pass", "times out: fail"],
      exitCode: 1,
    });
  });

  // Before its first await the runner knows the caller: its callback is on the stack.
  it("a test that waits in spawnSync before its first await is ended at its own timeout", async () => {
    const group = await runGroup(`
      const { promise: childEnded, resolve } = Promise.withResolvers<void>();

      test.concurrent("has no timeout", async () => {
        await childEnded;
      }, 0);

      test.concurrent("times out", () => {
        waitForChild(4000);
        resolve();
      }, 100);
    `);

    expect(group).toEqual({
      child: ["the child was ended early"],
      tests: ["has no timeout: pass", "times out: fail"],
      exitCode: 1,
    });
  });
});
