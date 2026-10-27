import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";

describe("spawn with spoofed array length", () => {
  test("Bun.spawnSync throws on array with length near u32 max", () => {
    const arr = ["echo", "hello"];
    Object.defineProperty(arr, "length", { value: 4294967295 });
    expect(() => {
      Bun.spawnSync(arr);
    }).toThrow(/cmd array is too large/);
  });

  test("Bun.spawn throws on array with length near u32 max", () => {
    const arr = ["echo", "hello"];
    Object.defineProperty(arr, "length", { value: 4294967295 });
    expect(() => {
      Bun.spawn(arr);
    }).toThrow(/cmd array is too large/);
  });

  test("Bun.spawnSync still works with normal arrays", () => {
    const result = Bun.spawnSync(["echo", "hello"]);
    expect(result.stdout.toString().trim()).toBe("hello");
    expect(result.exitCode).toBe(0);
  });
});

describe("non-array cmd in the options object", () => {
  const notAnArray = { name: "TypeError", code: "ERR_INVALID_ARG_TYPE", message: "cmd must be an array" };

  function outcome(call: () => any) {
    try {
      call().kill?.();
      return "did not throw";
    } catch (e: any) {
      return { name: e.name, code: e.code, message: e.message };
    }
  }

  const nonArrays: [string, () => unknown][] = [
    ["a string", () => "zz"],
    ["a String object", () => new String("zz")],
    ["a Buffer", () => Buffer.from("zz")],
    ["a Uint8Array", () => new Uint8Array([122, 122])],
    ["a Set", () => new Set(["zz"])],
    ["a function", () => () => {}],
    ["42", () => 42],
    ["0", () => 0],
    ["true", () => true],
    ["false", () => false],
    ["a plain object", () => ({})],
    ["a symbol", () => Symbol()],
    ["a bigint", () => 10n],
    ["an array-like object", () => ({ 0: bunExe(), 1: "--version", length: 2 })],
    [
      "an arguments object",
      () =>
        (function (..._: string[]) {
          return arguments;
        })(bunExe(), "--version"),
    ],
    ["a Proxy of an array", () => new Proxy([bunExe(), "--version"], {})],
  ];

  const fns: [string, (...args: any[]) => any][] = [
    ["Bun.spawn", Bun.spawn],
    ["Bun.spawnSync", Bun.spawnSync],
  ];

  describe.each(fns)("%s", (_, fn) => {
    test.each(nonArrays)("rejects %s", (_, cmd) => {
      // PATH and cwd are an empty directory, so a build that walks `cmd` resolves no bare name.
      // The bunExe() rows would run `bun --version`.
      using dir = tempDir("spawn-non-array-cmd", {});
      const options = {
        cmd: cmd(),
        env: { PATH: String(dir) },
        cwd: String(dir),
        stdio: ["ignore", "ignore", "ignore"],
      };
      expect(outcome(() => fn(options))).toEqual(notAnArray);
    });

    test("does not run the traps of a Proxy cmd", () => {
      const traps: string[] = [];
      const cmd = new Proxy([bunExe(), "--version"], {
        get(target, key, receiver) {
          traps.push(`get ${String(key)}`);
          return Reflect.get(target, key, receiver);
        },
        has(target, key) {
          traps.push(`has ${String(key)}`);
          return Reflect.has(target, key);
        },
      });
      const options = { cmd, env: bunEnv, stdio: ["ignore", "ignore", "ignore"] };
      expect({ outcome: outcome(() => fn(options)), traps }).toEqual({ outcome: notAnArray, traps: [] });
    });

    test("reports cmd before it reads another option", () => {
      const read: string[] = [];
      const options = {
        get cmd() {
          read.push("cmd");
          return "zz";
        },
        get argv0() {
          read.push("argv0");
          return undefined;
        },
        get cwd() {
          read.push("cwd");
          return undefined;
        },
        get signal() {
          read.push("signal");
          return AbortSignal.abort();
        },
        get onExit() {
          read.push("onExit");
          return 5;
        },
        get env() {
          read.push("env");
          return 5;
        },
      };
      expect({ outcome: outcome(() => fn(options)), read }).toEqual({ outcome: notAnArray, read: ["cmd"] });
    });

    test.each<[string, unknown[], string]>([
      ["{ cmd: [] }", [{ cmd: [] }], "cmd must not be empty"],
      ['{ cmd: "" }', [{ cmd: "" }], "cmd must be an array"],
      ["{ cmd: null }", [{ cmd: null }], "cmd must be an array"],
      ["{}", [{}], "cmd must be an array"],
      ["a positional string", ["zz"], "cmd must be an array"],
    ])("still rejects %s", (_, args, message) => {
      expect(outcome(() => fn(...args))).toEqual({ ...notAnArray, message });
    });
  });

  class Cmd extends Array<string> {}
  const subclass = () => new Cmd(bunExe(), "-e", "console.log('ran')");

  test("Bun.spawn accepts an Array subclass", async () => {
    await using proc = Bun.spawn({ cmd: subclass(), env: bunEnv, stderr: "ignore" });
    const [stdout, exitCode] = await Promise.all([proc.stdout.text(), proc.exited]);
    expect({ stdout, exitCode }).toEqual({ stdout: "ran\n", exitCode: 0 });
  });

  test("Bun.spawnSync accepts an Array subclass", () => {
    const { stdout, exitCode } = Bun.spawnSync({ cmd: subclass(), env: bunEnv, stderr: "ignore" });
    expect({ stdout: stdout.toString(), exitCode }).toEqual({ stdout: "ran\n", exitCode: 0 });
  });
});
