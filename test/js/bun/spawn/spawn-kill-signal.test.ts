import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, isLinux, shellExe } from "harness";
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

// Real-time signals (SIGRTMIN..SIGRTMAX) are Linux-specific and have no named
// SignalCode variant. `signalCode` must surface the raw number rather than
// dropping it and returning null.
describe.skipIf(!isLinux)("real-time signals", () => {
  // SIGRTMIN is 34 on glibc and 35 on musl; SIGRTMAX is 64 on both. Pick values
  // inside the range on every libc.
  for (const sig of [40, 64]) {
    test(`Bun.spawn signalCode surfaces real-time signal ${sig}`, async () => {
      await using proc = Bun.spawn({
        cmd: ["sleep", "100"],
        stdio: ["ignore", "ignore", "ignore"],
      });
      process.kill(proc.pid, sig);
      await proc.exited;
      expect({ signalCode: proc.signalCode, exitCode: proc.exitCode }).toEqual({
        signalCode: sig,
        exitCode: null,
      });
    });

    test(`Bun.$ completes when child is killed by real-time signal ${sig}`, async () => {
      // The shell runs inside a subprocess so a shell-side hang is observable
      // as {hung:true} rather than hanging this test file. The inner script
      // races against a sleep and force-exits so it always terminates.
      await using proc = Bun.spawn({
        cmd: [
          bunExe(),
          "-e",
          `const shell = Bun.$\`bash -c "kill -${sig} \\$\\$"\`.nothrow().then(r => ({ exitCode: r.exitCode }));
           const hang = Bun.sleep(3000).then(() => ({ hung: true }));
           console.log(JSON.stringify(await Promise.race([shell, hang])));
           process.exit(0);`,
        ],
        env: bunEnv,
        stdout: "pipe",
        stderr: "pipe",
      });

      const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
      expect({ stdout: stdout.trim(), exitCode }).toEqual({
        stdout: JSON.stringify({ exitCode: 128 + sig }),
        exitCode: 0,
      });
      expect(stderr).not.toContain("error");
    });
  }
});
