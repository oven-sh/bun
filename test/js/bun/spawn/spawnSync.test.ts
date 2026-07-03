import { describe, expect, it } from "bun:test";
import { bunEnv, bunExe, isLinux, isMusl, isPosix } from "harness";
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

  it.skipIf(process.platform !== "linux")("should use memfd when possible", () => {
    expect([join(import.meta.dir, "spawnSync-memfd-fixture.ts")]).toRun();
  });

  it.skipIf(!isPosix)("should use spawnSync optimizations when possible", () => {
    expect([join(import.meta.dir, "spawnSync-counters-fixture.ts")]).toRun();
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
