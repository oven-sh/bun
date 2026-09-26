import type { Subprocess } from "bun";
import { describe, expect, test } from "bun:test";
import { isLinux, isWindows, shellExe } from "harness";
import { constants } from "os";

const inputs = {
  SIGTERM: [["SIGTERM"], [undefined], [""], [null], [], [constants.signals.SIGTERM], [NaN]],
  SIGKILL: [["SIGKILL"], [constants.signals.SIGKILL]],
} as const;
const fails = [["SIGGOD"], [{}], [() => {}], [Infinity], [-Infinity], [Symbol("what")]] as const;
const signalNumbers: Record<string, number> = constants.signals;
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
      expect(err.message).toContain(isWindows ? "or 'SIGWINCH'" : "or 'SIGSYS'");
      expect(err.message).not.toContain("the SignalCode names");
      // Every listed name is a signal on this OS. Linux lists signal 16 as SIGSTKFLT
      // (its name in node and in `kill -l`), not "SIG16". Other systems do not list it.
      const listed = Array.from(err.message.matchAll(/'(SIG\w+)'/g), (match: RegExpMatchArray) => match[1]);
      expect(listed.filter(name => !(name in constants.signals))).toEqual([]);
      expect(listed.includes("SIGSTKFLT")).toBe("SIGSTKFLT" in constants.signals);
      // The list has one name for each signal number of this OS. An alias (SIGIOT for
      // SIGABRT, SIGPOLL for SIGIO on Linux) is a valid name too, and the list leaves it out.
      const numbers = (names: string[]) => names.map(name => signalNumbers[name]).sort((a, b) => a - b);
      expect(numbers(listed)).toEqual([...new Set(numbers(Object.keys(signalNumbers)))]);

      const { promise, resolve, reject } = Promise.withResolvers();
      proc.exited.then(resolve, reject);
      proc.kill();
      await promise;

      expect(proc.exitCode).toBe(null);
      expect(proc.signalCode).toBe("SIGTERM");
    });

    // `os.constants.signals` has every name this OS has. Before, SIGIOT, SIGPOLL (Linux),
    // SIGUNUSED (musl), SIGINFO (macOS) and SIGBREAK (Windows) were unknown names.
    test("every name in os.constants.signals is a valid signal name", async () => {
      const proc = Bun.spawn({
        cmd: [shellExe(), "-c", "exit 0"],
        stdio: ["inherit", "inherit", "inherit"],
      });
      await proc.exited;

      // After the exit, kill() still checks the name, and it sends nothing.
      expect(() => proc.kill("SIGGOD" as NodeJS.Signals)).toThrow("must be one of");
      const rejected = Object.keys(signalNumbers).filter(name => {
        try {
          proc.kill(name as NodeJS.Signals);
          return false;
        } catch {
          return true;
        }
      });
      expect(rejected).toEqual([]);
    });
  });
});

// macOS and the BSDs number some signals differently from Linux (SIGUSR1 is 10
// on Linux and 30 on macOS; 10 is SIGBUS there), and SIGSTKFLT exists only on
// Linux. `os.constants.signals` holds the OS's own numbers, so it is the
// oracle. All three terminate the child without a core dump.
const platformSignals = (["SIGUSR1", "SIGUSR2", "SIGSTKFLT"] as const).filter(name => name in constants.signals);

// An alias is a second name of a signal number: SIGIOT is SIGABRT, and on Linux SIGPOLL is
// SIGIO and SIGUNUSED (musl, Android) is SIGSYS. node reports the signal under the first name.
const aliases = (
  [
    ["SIGIOT", "SIGABRT"],
    ["SIGPOLL", "SIGIO"],
    ["SIGUNUSED", "SIGSYS"],
  ] as const
).filter(([alias]) => alias in constants.signals);

// Names that are signals on some OS, but not on every OS.
const unsupportedSignals = (
  ["SIGSTKFLT", "SIGPWR", "SIGIOT", "SIGPOLL", "SIGUNUSED", "SIGINFO", "SIGBREAK"] as const
).filter(name => !(name in constants.signals));

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

  describe.each(aliases)("%s is an alias of %s", (alias, name) => {
    const number = signalNumbers[alias];

    // SIGABRT and SIGSYS dump core, and CI fails a test that leaves a core file. The child
    // turns core dumps off and then prints a line, so the signal cannot come before that.
    const cmd = ["sh", "-c", "ulimit -c 0 && echo ready && exec sleep 1000"];
    const stdio = ["ignore", "pipe", "ignore"] as const;

    async function coreDumpsAreOff(proc: Subprocess<"ignore", "pipe", "ignore">) {
      const reader = proc.stdout.getReader();
      const decoder = new TextDecoder();
      let output = "";
      while (!output.includes("\n")) {
        const { value, done } = await reader.read();
        if (done) break;
        output += decoder.decode(value, { stream: true });
      }
      reader.releaseLock();
      expect(output).toBe("ready\n");
    }

    test("kill(alias) sends the signal, and signalCode is the first name", async () => {
      await using proc = Bun.spawn({ cmd, stdio });
      await coreDumpsAreOff(proc);
      proc.kill(alias);
      expect(await proc.exited).toBe(128 + number);
      expect({ exitCode: proc.exitCode, signalCode: proc.signalCode }).toEqual({ exitCode: null, signalCode: name });
    });

    test("killSignal: alias is delivered when the AbortSignal fires", async () => {
      const controller = new AbortController();
      await using proc = Bun.spawn({ cmd, stdio, killSignal: alias, signal: controller.signal });
      await coreDumpsAreOff(proc);
      controller.abort();
      expect(await proc.exited).toBe(128 + number);
      expect({ exitCode: proc.exitCode, signalCode: proc.signalCode }).toEqual({ exitCode: null, signalCode: name });
    });
  });
});

// Before, macOS sent signal 30 for "SIGPWR", which is SIGUSR1 there.
test.each(unsupportedSignals)("%s: a name this OS has no signal for is rejected like an unknown name", async name => {
  const rejected = (fn: () => unknown) => {
    let error: any;
    try {
      fn();
    } catch (e) {
      error = e;
    }
    expect(error).toBeInstanceOf(TypeError);
    expect(error.code).toBe("ERR_INVALID_ARG_TYPE");
    expect(error.message).toContain("must be one of 'SIGHUP'");
    expect(error.message).not.toContain(`'${name}'`);
  };

  await using proc = Bun.spawn({ cmd: [shellExe(), "-c", "sleep 1000"], ...quiet });
  rejected(() => proc.kill(name));

  // A child that exits on its own, so a spawn that wrongly succeeds leaves nothing behind.
  const cmd = [shellExe(), "-c", "exit 0"];
  rejected(() => Bun.spawn({ cmd, ...quiet, killSignal: name }));
  rejected(() => Bun.spawnSync({ cmd, ...quiet, timeout: 1, killSignal: name }));
});

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
