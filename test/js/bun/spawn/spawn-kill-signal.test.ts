import { dlopen } from "bun:ffi";
import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, isLinux, isWindows, shellExe, tempDir } from "harness";
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
          proc.kill(...(input as any));

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
        // @ts-expect-error
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

      const { promise, resolve, reject } = Promise.withResolvers();
      proc.exited.then(resolve, reject);
      proc.kill();
      await promise;

      expect(proc.exitCode).toBe(null);
      expect(proc.signalCode).toBe("SIGTERM");
    });
  });
});

// macOS and the BSDs number some signals differently from Linux (SIGUSR1 is 10
// on Linux and 30 on macOS; 10 is SIGBUS there), and SIGSTKFLT exists only on
// Linux. `os.constants.signals` holds the OS's own numbers, so it is the
// oracle. All three terminate the child without a core dump.
const platformSignals = (["SIGUSR1", "SIGUSR2", "SIGSTKFLT"] as const).filter(name => name in constants.signals);

// Names that are signals on Linux, but not on every OS (none are left on Linux).
const unsupportedSignals = (["SIGSTKFLT", "SIGPWR"] as const).filter(name => !(name in constants.signals));

const quiet: { stdio: ["ignore", "ignore", "ignore"] } = { stdio: ["ignore", "ignore", "ignore"] };

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
      expect({ exitCode, signalCode }).toEqual<unknown>({ exitCode: null, signalCode: name });
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
    expect({ exitCode, signalCode }).toEqual<unknown>({ exitCode: null, signalCode: 40 });
  });
});

// Windows has no signals: SIGINT, SIGQUIT, SIGKILL and SIGTERM terminate the process, 0 checks that it is alive.
describe.concurrent.skipIf(!isWindows)("kill on Windows", () => {
  const idleCmd = [bunExe(), "-e", "setInterval(() => {}, 1e6)"];
  const captureErrorCode = (fn: () => unknown) => {
    try {
      return fn();
    } catch (error: any) {
      return error.code;
    }
  };

  test.each([
    ["SIGINT", 2],
    ["SIGQUIT", 3],
    ["SIGKILL", 9],
    ["SIGTERM", 15],
  ] as const)("subprocess.kill(%s) terminates the child and sets signalCode", async (signal, number) => {
    await using proc = Bun.spawn({ cmd: idleCmd, env: bunEnv, ...quiet });
    proc.kill(signal);
    const exited = await proc.exited;
    expect({ exited, exitCode: proc.exitCode, signalCode: proc.signalCode }).toEqual({
      exited: 128 + number,
      exitCode: null,
      signalCode: signal,
    });
  });

  test.each(["SIGINT", "SIGQUIT", "SIGKILL", "SIGTERM"] as const)(
    "process.kill(pid, %s) terminates the child with exit code 1 and no signalCode",
    async signal => {
      await using proc = Bun.spawn({ cmd: idleCmd, env: bunEnv, ...quiet });
      expect(process.kill(proc.pid, signal)).toBe(true);
      const exited = await proc.exited;
      expect({ exited, signalCode: proc.signalCode }).toEqual({ exited: 1, signalCode: null });
    },
  );

  test.each([
    ["SIGQUIT", "REG_SZ", ["ping.exe.PID.dmp"]],
    ["SIGQUIT", "REG_EXPAND_SZ", ["ping.exe.PID.dmp"]],
    ["SIGTERM", "REG_SZ", []],
  ])("dumps after %s with LocalDumps enabled and a DumpFolder of type %s: %j", async (signal, type, expected) => {
    using dir = tempDir("local-dumps", {
      "main.js": `
        const advapi32 = require("bun:ffi").dlopen("advapi32.dll", {
          RegLoadAppKeyW: { args: ["ptr", "ptr", "u32", "u32", "u32"], returns: "i32" },
          RegSetKeyValueW: { args: ["i64", "ptr", "ptr", "u32", "ptr", "u32"], returns: "i32" },
          RegOverridePredefKey: { args: ["i64", "i64"], returns: "i32" },
        }).symbols;
        const wide = text => Buffer.from(text + "\\0", "utf16le");
        const HKEY_LOCAL_MACHINE = -0x7ffffffe;
        const KEY_ALL_ACCESS = 0xf003f;
        const [type, folder] = { REG_SZ: [1, process.cwd()], REG_EXPAND_SZ: [2, "%DUMP_PARENT%"] }.${type};
        const value = wide(folder + "\\\\dumps");
        // A private hive stands in for HKEY_LOCAL_MACHINE in this process only.
        const hive = new BigInt64Array(1);
        advapi32.RegLoadAppKeyW(wide(process.cwd() + "\\\\hive"), hive, KEY_ALL_ACCESS, 0, 0);
        const key = wide("SOFTWARE\\\\Microsoft\\\\Windows\\\\Windows Error Reporting\\\\LocalDumps");
        advapi32.RegSetKeyValueW(hive[0], key, wide("DumpFolder"), type, value, value.length);
        advapi32.RegOverridePredefKey(HKEY_LOCAL_MACHINE, hive[0]);

        const child = Bun.spawn(["ping.exe", "-t", "127.0.0.1"], { stdout: "pipe" });
        await child.stdout.getReader().read();
        child.kill("${signal}");
        await child.exited;
        const fs = require("fs");
        const names = fs.existsSync("dumps") ? fs.readdirSync("dumps") : [];
        const dumps = names.filter(name => fs.readFileSync("dumps/" + name, "latin1").startsWith("MDMP"));
        console.log(JSON.stringify(dumps.map(name => name.toLowerCase().replace(child.pid, "PID"))), child.signalCode);
      `,
    });
    await using proc = Bun.spawn({
      cmd: [bunExe(), "main.js"],
      cwd: String(dir),
      env: { ...bunEnv, DUMP_PARENT: String(dir) },
      stderr: "inherit",
    });
    expect(await proc.stdout.text()).toBe(`${JSON.stringify(expected)} ${signal}\n`);
    expect(await proc.exited).toBe(0);
  });

  test("signalCode reports the first signal sent", async () => {
    await using proc = Bun.spawn({ cmd: idleCmd, env: bunEnv, ...quiet });
    proc.kill("SIGTERM");
    proc.kill(0);
    proc.kill("SIGKILL");
    await proc.exited;
    expect(proc.signalCode).toBe("SIGTERM");
  });

  test("process.kill() accepts pid 0 and rejects pid -1 and invalid signals", () => {
    expect([captureErrorCode(() => process.kill(0, 0)), captureErrorCode(() => process.kill(-1, 0))]).toEqual([
      true,
      "ESRCH",
    ]);
    expect(captureErrorCode(() => process.kill(process.pid, 64))).toBe("EINVAL");
  });

  // 259 is STILL_ACTIVE, which GetExitCodeProcess() also returns for a running process.
  test.each([0, 259])("process.kill() throws ESRCH after exit code %d while a handle is still open", async code => {
    const k32 = dlopen("kernel32.dll", {
      OpenProcess: { args: ["u32", "i32", "u32"], returns: "u64" },
      CloseHandle: { args: ["u64"], returns: "i32" },
    });
    await using proc = Bun.spawn({
      cmd: [process.env.ComSpec!, "/d", "/c", `set /p line= & exit ${code}`],
      env: bunEnv,
      stdio: ["pipe", "ignore", "ignore"],
    });
    const SYNCHRONIZE = 0x100000;
    const handle = k32.symbols.OpenProcess(SYNCHRONIZE, 0, proc.pid);
    try {
      expect(handle).not.toBe(0n);
      proc.stdin.write("go\r\n");
      await proc.stdin.end();
      await proc.exited;
      expect(proc.signalCode).toBeNull();
      expect([
        captureErrorCode(() => process.kill(proc.pid, 0)),
        captureErrorCode(() => process.kill(proc.pid, "SIGTERM")),
      ]).toEqual(["ESRCH", "ESRCH"]);
    } finally {
      k32.symbols.CloseHandle(handle);
      k32.close();
    }
  });
});

test("kill(0) does not set signalCode", async () => {
  await using proc = Bun.spawn({
    cmd: [bunExe(), "-e", "await Bun.stdin.text(); process.exit(7)"],
    env: bunEnv,
    stdio: ["pipe", "ignore", "ignore"],
  });
  proc.kill(0);
  await proc.stdin.end();
  const exited = await proc.exited;
  expect({ exited, signalCode: proc.signalCode }).toEqual({ exited: 7, signalCode: null });
});
