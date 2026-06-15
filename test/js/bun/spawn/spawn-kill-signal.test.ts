import { describe, expect, test } from "bun:test";
import { isLinux, shellExe } from "harness";
import { constants } from "os";

const inputs = {
  SIGTERM: [["SIGTERM"], [undefined], [""], [null], [], [constants.signals.SIGTERM], [NaN]],
  SIGKILL: [["SIGKILL"], [constants.signals.SIGKILL]],
} as const;
const fails = [["SIGGOD"], [{}], [() => {}], [Infinity], [-Infinity], [Symbol("what")]] as const;
describe("subprocess.kill", () => {
  for (const key in inputs) {
    describe(key, () => {
      for (let input of inputs[key as keyof typeof inputs]) {
        test(Bun.inspect(input).replaceAll("\n", "\\n"), async () => {
          const proc = Bun.spawn({
            cmd: [shellExe(), "-c", "sleep 1000"],
            stdio: ["inherit", "inherit", "inherit"],
          });

          const { promise, resolve, reject } = Promise.withResolvers();
          proc.exited.then(resolve, reject);
          proc.kill(...input);

          await promise;
          expect(proc.exitCode).toBe(null);
          expect(proc.signalCode).toBe(key as any);
        });
      }
    });
  }

  describe("input validation", () => {
    for (let input of fails) {
      test(Bun.inspect(input).replaceAll("\n", "\\n"), async () => {
        const proc = Bun.spawn({
          cmd: [shellExe(), "-c", "sleep 1000"],
          stdio: ["inherit", "inherit", "inherit"],
        });

        expect(() => proc.kill(...(input as any))).toThrow();

        const { promise, resolve, reject } = Promise.withResolvers();
        proc.exited.then(resolve, reject);
        proc.kill();

        await promise;

        expect(proc.exitCode).toBe(null);
        expect(proc.signalCode).toBe("SIGTERM");
      });
    }

    test("invalid signal name lists the valid signal names", async () => {
      const proc = Bun.spawn({
        cmd: [shellExe(), "-c", "sleep 1000"],
        stdio: ["inherit", "inherit", "inherit"],
      });

      let err: any;
      try {
        proc.kill("SIGGOD");
      } catch (e) {
        err = e;
      }

      expect(err).toBeInstanceOf(TypeError);
      expect(err.code).toBe("ERR_INVALID_ARG_TYPE");
      // The message must enumerate the real signal names, not a static
      // "the SignalCode names" placeholder (regressed in the Rust port).
      expect(err.message).toContain("'SIGHUP'");
      expect(err.message).toContain("'SIGTERM'");
      expect(err.message).toContain("'SIGKILL'");
      expect(err.message).toContain("or 'SIGSYS'");
      expect(err.message).not.toContain("the SignalCode names");

      const { promise, resolve, reject } = Promise.withResolvers();
      proc.exited.then(resolve, reject);
      proc.kill();
      await promise;

      expect(proc.exitCode).toBe(null);
      expect(proc.signalCode).toBe("SIGTERM");
    });
  });
});

// Linux real-time signals (SIGRTMIN..SIGRTMAX, 32..64) have no name in the
// SignalCode table; Bun.spawn must still surface the raw numeric signal in
// both the `signalCode` getter and the third `onExit` argument rather than
// dropping it to null.
test.skipIf(!isLinux)("signalCode returns numeric value for real-time signals", async () => {
  const { promise: exitPromise, resolve: onExitResolve } = Promise.withResolvers<any>();
  await using proc = Bun.spawn({
    cmd: ["sleep", "30"],
    stdio: ["ignore", "ignore", "ignore"],
    onExit(_subprocess, exitCode, signalCode) {
      onExitResolve({ exitCode, signalCode });
    },
  });

  // SIGRTMIN is >= 32 on every Linux libc; pick a value comfortably inside the
  // RT range on both glibc (SIGRTMIN=34) and musl (SIGRTMIN=35).
  const rtSignal = 40;
  process.kill(proc.pid, rtSignal);
  await proc.exited;
  const onExitArgs = await exitPromise;

  expect({
    signalCode: proc.signalCode,
    exitCode: proc.exitCode,
    onExit: onExitArgs,
  }).toEqual({
    signalCode: rtSignal,
    exitCode: null,
    onExit: { exitCode: null, signalCode: rtSignal },
  });
});
