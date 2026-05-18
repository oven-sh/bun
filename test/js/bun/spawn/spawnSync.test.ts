import { describe, expect, it } from "bun:test";
import { bunEnv, bunExe, isPosix } from "harness";
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

  // On Linux, JSC uses SIGPWR to suspend/resume threads for GC. The spawnSync
  // signal-forwarding table used to include SIGPWR, so a GC that fired while
  // (or after) spawnSync ran would terminate the process with signal 30.
  it.skipIf(process.platform !== "linux")("does not clobber the GC thread-suspend signal handler", () => {
    const result = Bun.spawnSync({
      cmd: [
        bunExe(),
        "-e",
        `
          for (let i = 0; i < 50; i++) {
            Bun.spawnSync({ cmd: ["true"] });
            Bun.gc(true);
          }
          for (let i = 0; i < 50; i++) {
            Bun.spawnSync({ cmd: ["true"] });
          }
          Bun.gc(true);
        `,
      ],
      env: bunEnv,
      stdout: "inherit",
      stderr: "inherit",
    });
    expect(result.signalCode).toBeFalsy();
    expect(result.exitCode).toBe(0);
  });
});
