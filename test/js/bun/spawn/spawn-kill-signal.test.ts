import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, shellExe } from "harness";
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

  // Signal 0 checks that the process can be signalled and delivers nothing.
  describe("signal 0", () => {
    const idle = () =>
      Bun.spawn({
        cmd: [bunExe(), "-e", "setInterval(() => {}, 1e6)"],
        env: bunEnv,
        stdio: ["inherit", "inherit", "inherit"],
      });

    test("leaves a running process running", async () => {
      await using proc = idle();
      proc.kill(0);
      expect({ killed: proc.killed, exitCode: proc.exitCode, signalCode: proc.signalCode }).toEqual({
        killed: false,
        exitCode: null,
        signalCode: null,
      });
      proc.kill("SIGKILL");
      await proc.exited;
      expect({ exitCode: proc.exitCode, signalCode: proc.signalCode }).toEqual({
        exitCode: null,
        signalCode: "SIGKILL",
      });
    });

    // On Windows the signal a process was ended with is what kill() recorded.
    // A process that has been told to end still answers a probe for a moment.
    test("after SIGTERM, the exit is still reported as SIGTERM", async () => {
      await using proc = idle();
      proc.kill("SIGTERM");
      for (let i = 0; i < 100; i++) proc.kill(0);
      await proc.exited;
      expect({ exitCode: proc.exitCode, signalCode: proc.signalCode }).toEqual({
        exitCode: null,
        signalCode: "SIGTERM",
      });
    });

    test("does not throw for a process that has exited", async () => {
      await using proc = idle();
      proc.kill("SIGKILL");
      await proc.exited;
      expect(() => proc.kill(0)).not.toThrow();
      expect({ exitCode: proc.exitCode, signalCode: proc.signalCode }).toEqual({
        exitCode: null,
        signalCode: "SIGKILL",
      });
    });
  });

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
