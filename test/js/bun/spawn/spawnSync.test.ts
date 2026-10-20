import { describe, expect, it } from "bun:test";
import { bunEnv, bunExe, bunRun, isASAN, isLinux, isMusl, isPosix, isRoot, isWindows, tempDir } from "harness";
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

// A test times out while it waits in spawnSync. The runner then sends the child its kill signal, and SIGTERM with the
// other processes of that test. A child that ignores both used to keep the test waiting for as long as it ran.
// Windows ends a process on the first signal. Every case starts a `bun test`: an ASAN build starts too slowly to run
// them all at once inside the timeout of a case.
(isASAN ? describe : describe.concurrent).skipIf(isWindows)("the timeout of a test that waits in spawnSync", () => {
  const prelude = /* ts */ `
    import { test } from "bun:test";
    import { spawnSync } from "node:child_process";
    import { readFileSync } from "node:fs";

    const ignore = { stdin: "ignore", stdout: "ignore", stderr: "ignore" } as const;

    function report({ exitCode, signalCode }: { exitCode: number | null; signalCode?: unknown }) {
      console.log(\`the child ended: exitCode \${exitCode}, signalCode \${signalCode ?? null}\`);
    }
  `;

  async function runTestFile(source: string, { noOrphans = false } = {}) {
    for (let attempt = 1; ; attempt++) {
      using dir = tempDir("spawnsync-test-timeout", { "timeout.test.ts": prelude + source });
      await using proc = Bun.spawn({
        cmd: [bunExe(), "test", "timeout.test.ts"],
        // The mode is the runner's choice for some CI lanes, so every case names it.
        env: { ...bunEnv, BUN_FEATURE_FLAG_NO_ORPHANS: noOrphans ? "1" : undefined },
        cwd: String(dir),
        stdin: "ignore",
        stdout: "pipe",
        stderr: "pipe",
      });
      const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
      const combined = stdout + stderr;
      // No child of these cases ends on SIGTERM or misses its first SIGURG once it is set up: this one was signalled
      // sooner than that, on a machine too slow for the case. That run says nothing about the runner: do it again.
      if (attempt === 3 || !/signalCode SIGTERM|got SIGURG 0 times/.test(combined)) return { combined, exitCode };
    }
  }

  // One process: `sleep` keeps the SIGTERM that `sh` ignores. Nothing tells a caller that waits in spawnSync when
  // `sh` has done that, so no case sends SIGTERM sooner than 300 ms after the spawn.
  const ignoresSigterm = (seconds: number) => JSON.stringify(["sh", "-c", `trap '' TERM; exec sleep ${seconds}`]);
  // SIGURG does nothing to a process that does not handle it.
  const ownTimeout = `timeout: 100, killSignal: "SIGURG"`;

  const sigkill = "the child ended: exitCode null, signalCode SIGKILL";

  it.each([
    ["Bun.spawnSync", `test("times out", () => { report(Bun.spawnSync({ cmd, ...ignore })); }, 300);`],
    [
      "child_process.spawnSync",
      `test("times out", () => {
        const { status, signal } = spawnSync(cmd[0], cmd.slice(1), { stdio: "ignore" });
        report({ exitCode: status, signalCode: signal });
      }, 300);`,
    ],
    [
      "Bun.spawnSync after an await",
      `test("times out", async () => {
        await new Promise(resolve => setImmediate(resolve));
        report(Bun.spawnSync({ cmd, ...ignore }));
      }, 300);`,
    ],
    [
      "Bun.spawnSync after its own timeout",
      `test("times out", () => { report(Bun.spawnSync({ cmd, ${ownTimeout}, ...ignore })); }, 300);`,
    ],
  ])("%s: the child is sent SIGKILL", async (_, timesOut) => {
    const { combined, exitCode } = await runTestFile(`const cmd = ${ignoresSigterm(3)}; ${timesOut}`);

    expect(combined).toContain(sigkill);
    expect(combined).toContain("(fail) times out");
    expect(exitCode).toBe(1);
  });

  it("in no-orphans mode too", async () => {
    const { combined, exitCode } = await runTestFile(
      `test("times out", () => { report(Bun.spawnSync({ cmd: ${ignoresSigterm(3)}, ...ignore })); }, 300);`,
      { noOrphans: true },
    );

    expect(combined).toContain(sigkill);
    expect(exitCode).toBe(1);
  });

  it("a test that is done before spawnSync returns keeps the child", async () => {
    const { combined, exitCode } = await runTestFile(`
      test("is done in time", done => {
        setImmediate(() => {
          done();
          report(Bun.spawnSync({ cmd: ${ignoresSigterm(1.2)}, ...ignore }));
        });
      }, 300);
    `);

    expect(combined).toContain("the child ended: exitCode 0, signalCode null");
    expect(combined).toContain("(pass) is done in time");
    expect(exitCode).toBe(0);
  });

  it("in a group of concurrent tests, the timeout of one test does not send SIGKILL to the child of another", async () => {
    const { combined, exitCode } = await runTestFile(`
      test.concurrent("times out", async () => {
        await new Promise(() => {});
      }, 100);

      test.concurrent("has no timeout", async () => {
        await new Promise(resolve => setImmediate(resolve));
        report(Bun.spawnSync({ cmd: ["sleep", "1"], killSignal: "SIGURG", ...ignore }));
      }, 0);
    `);

    expect(combined).toContain("the child ended: exitCode 0, signalCode null");
    expect(combined).toContain("(pass) has no timeout");
    expect(exitCode).toBe(1);
  });

  it("in a group of concurrent tests, a deadline after the timeout of spawnSync does not signal the child again", async () => {
    const countsSigurg = [
      "sh",
      "-c",
      "n=0; trap 'n=$((n+1))' URG; i=0; while [ $i -lt 120 ]; do sleep 0.01; i=$((i+1)); done; echo $n > signals",
    ];
    const { combined } = await runTestFile(`
      test.concurrent("runs in the same group", () => {});

      test.concurrent("calls spawnSync", async () => {
        await new Promise(resolve => setImmediate(resolve));
        const start = performance.now();
        Bun.spawnSync({ cmd: ${JSON.stringify(countsSigurg)}, timeout: 300, killSignal: "SIGURG", ...ignore });
        console.log("the deadline of the test passed during the call: " + (performance.now() - start > 600));
        console.log("the child got SIGURG " + readFileSync("signals", "utf8").trim() + " times");
      }, 600);
    `);

    expect(combined).toContain("the deadline of the test passed during the call: true");
    expect(combined).toContain("the child got SIGURG 1 times");
  });

  it("the timeout of spawnSync alone does not send SIGKILL", async () => {
    const { combined, exitCode } = await runTestFile(`
      test("does not time out", () => {
        report(Bun.spawnSync({ cmd: ["sleep", "1"], ${ownTimeout}, ...ignore }));
      });
    `);

    expect(combined).toContain("the child ended: exitCode 0, signalCode null");
    expect(exitCode).toBe(0);
  });

  it("a child that exits on SIGTERM keeps its exit code", async () => {
    const exitsOnSigterm = [
      "sh",
      "-c",
      "trap 'exit 7' TERM; i=0; while [ $i -lt 300 ]; do sleep 0.01; i=$((i+1)); done",
    ];
    const { combined, exitCode } = await runTestFile(
      `test("times out", () => { report(Bun.spawnSync({ cmd: ${JSON.stringify(exitsOnSigterm)}, ...ignore })); }, 300);`,
    );

    expect(combined).toContain("the child ended: exitCode 7, signalCode null");
    expect(exitCode).toBe(1);
  });
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
