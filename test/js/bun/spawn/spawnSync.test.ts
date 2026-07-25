import { describe, expect, it } from "bun:test";
import { bunEnv, bunExe, isLinux, isMusl, isPosix, isWindows } from "harness";
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

  it.skipIf(process.platform !== "linux")("should use memfd when possible", () => {
    expect([join(import.meta.dir, "spawnSync-memfd-fixture.ts")]).toRun();
  });

  it.skipIf(!isPosix)("should use spawnSync optimizations when possible", () => {
    expect([join(import.meta.dir, "spawnSync-counters-fixture.ts")]).toRun();
  });

  // `stdin: "pipe"` must give the child a real pipe, not the null device:
  // remapping to "ignore" opens NUL on Windows, which an AppContainer's
  // default device ACL denies. Node's SyncProcessRunner always creates a pipe.
  it("stdin 'pipe' gives the child a pipe (not the null device) that reads EOF", () => {
    const { stdout, exitCode } = Bun.spawnSync({
      cmd: [
        bunExe(),
        "-e",
        `const fs = require("fs");
         let n = 0;
         process.stdin.on("data", d => (n += d.length));
         process.stdin.on("end", () =>
           console.log(JSON.stringify({ isChar: fs.fstatSync(0).isCharacterDevice(), n })),
         );`,
      ],
      env: bunEnv,
      stdio: ["pipe", "pipe", "inherit"],
    });
    expect(JSON.parse(stdout.toString())).toEqual({ isChar: false, n: 0 });
    expect(exitCode).toBe(0);
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
