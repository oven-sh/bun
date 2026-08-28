import { describe, expect, test } from "bun:test";
import { isLinux, isWindows, shellExe } from "harness";
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
      // Signal 16 is SIGSTKFLT (its name in node and in `kill -l`), not "SIG16".
      expect(err.message).toContain("'SIGSTKFLT'");
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

// Bun's signal table is numbered like Linux. macOS and the BSDs number these
// differently (SIGUSR1 is 10 on Linux and 30 on macOS; 10 is SIGBUS there),
// and SIGSTKFLT exists only on Linux. `os.constants.signals` holds the OS's
// own numbers, so it is the oracle. All three terminate the child without a
// core dump.
const platformSignals = (["SIGUSR1", "SIGUSR2", "SIGSTKFLT"] as const).filter(name => name in constants.signals);

// A name from Bun's table that this OS has no signal for (none on Linux).
const unsupportedSignal = (["SIGSTKFLT", "SIGPWR"] as const).find(name => !(name in constants.signals));

const quiet = { stdio: ["ignore", "ignore", "ignore"] } as const;

describe.concurrent.skipIf(isWindows)("signal names map to the OS's own numbers", () => {
  describe.each(platformSignals)("%s", name => {
    const number: number = constants.signals[name];

    test("kill(name) sends that signal, and exited resolves to 128 + its number", async () => {
      await using proc = Bun.spawn({ cmd: ["sleep", "1000"], ...quiet });
      proc.kill(name);
      expect(await proc.exited).toBe(128 + number);
      expect({ exitCode: proc.exitCode, signalCode: proc.signalCode }).toEqual({ exitCode: null, signalCode: name });
    });

    test("kill(number) is reported under the OS's name for that number", async () => {
      await using proc = Bun.spawn({ cmd: ["sleep", "1000"], ...quiet });
      proc.kill(number);
      expect(await proc.exited).toBe(128 + number);
      expect({ exitCode: proc.exitCode, signalCode: proc.signalCode }).toEqual({ exitCode: null, signalCode: name });
    });

    test("killSignal: name is delivered as that signal when the AbortSignal fires", async () => {
      const controller = new AbortController();
      const { promise, resolve } = Promise.withResolvers<[number | null, string | number | null]>();
      await using proc = Bun.spawn({
        cmd: ["sleep", "1000"],
        ...quiet,
        killSignal: name,
        signal: controller.signal,
        onExit(_, exitCode, signalCode) {
          resolve([exitCode, signalCode]);
        },
      });
      controller.abort();
      expect(await proc.exited).toBe(128 + number);
      expect(await promise).toEqual([null, name]);
    });

    test("spawnSync reports the signal under the OS's name", () => {
      const { exitCode, signalCode } = Bun.spawnSync({
        cmd: ["sleep", "1000"],
        ...quiet,
        timeout: 1,
        killSignal: number,
      });
      expect({ exitCode, signalCode }).toEqual({ exitCode: null, signalCode: name });
    });
  });
});

test.skipIf(unsupportedSignal === undefined)(
  `${unsupportedSignal}: a name this OS has no signal for throws ERR_UNKNOWN_SIGNAL`,
  async () => {
    const name = unsupportedSignal!;
    const error = expect.objectContaining({ code: "ERR_UNKNOWN_SIGNAL", message: `Unknown signal: ${name}` });

    await using proc = Bun.spawn({ cmd: [shellExe(), "-c", "sleep 1000"], ...quiet });
    expect(() => proc.kill(name)).toThrow(error);

    // A child that exits on its own, so a spawn that wrongly succeeds leaves nothing behind.
    const cmd = [shellExe(), "-c", "exit 0"];
    expect(() => Bun.spawn({ cmd, ...quiet, killSignal: name })).toThrow(error);
    expect(() => Bun.spawnSync({ cmd, ...quiet, timeout: 1, killSignal: name })).toThrow(error);
  },
);

// Linux real-time signals have no name in Bun's table (SIGRTMIN is 34 on glibc
// and 35 on musl, SIGRTMAX is 64 on both), so signalCode is the number itself.
// Bun's own kill() only sends signals below 32, so the signal comes from
// process.kill or from the child. Before, signalCode was null and `exited` read
// after the exit was 254.
describe.concurrent.skipIf(!isLinux)("a signal with no name", () => {
  test.each([40, 64])("signalCode is the number and exited is 128 + it (%d)", async signal => {
    await using proc = Bun.spawn({ cmd: ["sleep", "1000"], ...quiet });
    process.kill(proc.pid, signal);
    const exited = await proc.exited;
    expect({ exited, exitCode: proc.exitCode, signalCode: proc.signalCode }).toEqual({
      exited: 128 + signal,
      exitCode: null,
      signalCode: signal,
    });
  });

  test.each([40, 64])("exited first read after the exit also gives 128 + the signal (%d)", async signal => {
    const { promise, resolve } = Promise.withResolvers<void>();
    await using proc = Bun.spawn({ cmd: ["sleep", "1000"], ...quiet, onExit: () => resolve() });
    process.kill(proc.pid, signal);
    await promise;
    // The promise is created now, from the stored status (this used to give 254).
    expect(await proc.exited).toBe(128 + signal);
  });

  test("spawnSync reports the number too", () => {
    const { exitCode, signalCode } = Bun.spawnSync({ cmd: ["sh", "-c", "kill -40 $$"], ...quiet });
    expect({ exitCode, signalCode }).toEqual({ exitCode: null, signalCode: 40 });
  });
});
