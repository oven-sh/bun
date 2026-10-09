import { heapStats } from "bun:jsc";
import { afterEach, describe, expect, jest, mock, setSystemTime, test, vi } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { AsyncLocalStorage } from "node:async_hooks";

async function run(args: string[], files: Record<string, string>, env: Record<string, string | undefined> = {}) {
  using dir = tempDir("vi-utils", files);
  await using proc = Bun.spawn({
    cmd: [bunExe(), ...args],
    env: { ...bunEnv, ...env },
    cwd: String(dir),
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  return { stdout, stderr, exitCode };
}

const results = (stderr: string) =>
  stderr
    .split("\n")
    .filter(line => /^\((pass|fail|skip|todo)\)/.test(line))
    .map(line => line.replace(/ \[[\d.]+ms\]$/, ""));

describe("vi.stubEnv", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    delete process.env.VI_UTILS_EXISTING;
  });

  test("sets process.env and import.meta.env, and unstubAllEnvs restores the first original", () => {
    process.env.VI_UTILS_EXISTING = "original";
    expect(vi.stubEnv("VI_UTILS_EXISTING", "first")).toBe(vi);
    expect(process.env.VI_UTILS_EXISTING).toBe("first");
    expect(import.meta.env.VI_UTILS_EXISTING).toBe("first");
    expect(Bun.env.VI_UTILS_EXISTING).toBe("first");
    vi.stubEnv("VI_UTILS_EXISTING", "second");
    expect(process.env.VI_UTILS_EXISTING).toBe("second");
    expect(vi.unstubAllEnvs()).toBe(vi);
    expect(process.env.VI_UTILS_EXISTING).toBe("original");
  });

  test("a variable that was not set is deleted again", () => {
    vi.stubEnv("VI_UTILS_NEW", "value");
    expect(process.env.VI_UTILS_NEW).toBe("value");
    vi.unstubAllEnvs();
    expect("VI_UTILS_NEW" in process.env).toBe(false);
  });

  test("undefined deletes the variable until it is restored", () => {
    process.env.VI_UTILS_EXISTING = "original";
    vi.stubEnv("VI_UTILS_EXISTING", undefined);
    expect("VI_UTILS_EXISTING" in process.env).toBe(false);
    vi.unstubAllEnvs();
    expect(process.env.VI_UTILS_EXISTING).toBe("original");
  });

  test.each([
    [null, "null"],
    [0, "0"],
    [true, "true"],
    [false, "false"],
    [{}, "[object Object]"],
    [[1, 2], "1,2"],
    [10n, "10"],
  ])("%p is stored as a string", (value, expected) => {
    // @ts-expect-error
    vi.stubEnv("VI_UTILS_NEW", value);
    expect(process.env.VI_UTILS_NEW).toBe(expected);
  });

  test.each(["DEV", "PROD", "SSR"] as const)("%s is a boolean", name => {
    vi.stubEnv(name, true);
    expect(process.env[name]).toBe("1");
    vi.stubEnv(name, false);
    expect(process.env[name]).toBe("");
    // @ts-expect-error
    vi.stubEnv(name, "anything");
    expect(process.env[name]).toBe("1");
    vi.stubEnv(name, undefined);
    expect(name in process.env).toBe(false);
    vi.unstubAllEnvs();
    expect(name in process.env).toBe(false);
  });

  test("the name is converted to a string", () => {
    // @ts-expect-error
    vi.stubEnv(5, "five");
    expect(process.env["5"]).toBe("five");
    vi.unstubAllEnvs();
    expect("5" in process.env).toBe(false);
    // @ts-expect-error
    expect(() => vi.stubEnv(Symbol("name"), "value")).toThrow(TypeError);
  });

  test("an inherited property is not an original", () => {
    vi.stubEnv("hasOwnProperty", "stub");
    expect<unknown>(process.env.hasOwnProperty).toBe("stub");
    vi.unstubAllEnvs();
    expect(Object.hasOwn(process.env, "hasOwnProperty")).toBe(false);
  });

  test("TZ takes effect and is restored", () => {
    const date = new Date("2020-01-01T00:00:00.000Z");
    const before = date.getHours();
    vi.stubEnv("TZ", "Asia/Tokyo");
    expect(date.getHours()).toBe(9);
    vi.unstubAllEnvs();
    expect(date.getHours()).toBe(before);
  });

  test("follows a process.env that was replaced", () => {
    const original = process.env;
    try {
      process.env = { ...original, VI_UTILS_EXISTING: "copy" };
      vi.stubEnv("VI_UTILS_EXISTING", "stub");
      expect(process.env.VI_UTILS_EXISTING).toBe("stub");
      vi.unstubAllEnvs();
      expect(process.env.VI_UTILS_EXISTING).toBe("copy");
    } finally {
      process.env = original;
    }
  });

  test("unstubAllEnvs without stubs does nothing", () => {
    expect(vi.unstubAllEnvs()).toBe(vi);
  });
});

describe("vi.stubGlobal", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  const stubbed = { writable: true, enumerable: true, configurable: true };

  test("defines the global, and unstubAllGlobals restores the first original", () => {
    const original = Object.getOwnPropertyDescriptor(globalThis, "fetch");
    expect(vi.stubGlobal("fetch", "first")).toBe(vi);
    expect(Object.getOwnPropertyDescriptor(globalThis, "fetch")).toEqual({ value: "first", ...stubbed });
    expect<unknown>(fetch).toBe("first");
    vi.stubGlobal("fetch", "second");
    expect<unknown>(fetch).toBe("second");
    expect(vi.unstubAllGlobals()).toBe(vi);
    expect(Object.getOwnPropertyDescriptor(globalThis, "fetch")).toEqual(original);
    expect(fetch).toBe(original!.value);
  });

  test("a global that did not exist is deleted again", () => {
    vi.stubGlobal("viUtilsNew", 1);
    vi.stubGlobal("viUtilsUndefined", undefined);
    expect(Object.getOwnPropertyDescriptor(globalThis, "viUtilsNew")).toEqual({ value: 1, ...stubbed });
    expect(Object.getOwnPropertyDescriptor(globalThis, "viUtilsUndefined")).toEqual({ value: undefined, ...stubbed });
    vi.unstubAllGlobals();
    expect("viUtilsNew" in globalThis).toBe(false);
    expect("viUtilsUndefined" in globalThis).toBe(false);
  });

  test("symbol and number names", () => {
    const symbol = Symbol("viUtils");
    vi.stubGlobal(symbol, "symbol");
    vi.stubGlobal(7, "first");
    vi.stubGlobal("7", "second");
    expect(globalThis[symbol]).toBe("symbol");
    expect(globalThis[7]).toBe("second");
    vi.unstubAllGlobals();
    expect(symbol in globalThis).toBe(false);
    expect(7 in globalThis).toBe(false);
  });

  test.each([
    { get: () => "getter", set: undefined, enumerable: false, configurable: true },
    { get: () => "getter", set(_: unknown) {}, enumerable: true, configurable: true },
    { value: 1, writable: false, enumerable: false, configurable: true },
  ])("restores the descriptor %p", descriptor => {
    try {
      Object.defineProperty(globalThis, "viUtilsDescriptor", descriptor);
      vi.stubGlobal("viUtilsDescriptor", "stub");
      expect(Object.getOwnPropertyDescriptor(globalThis, "viUtilsDescriptor")).toEqual({ value: "stub", ...stubbed });
      vi.unstubAllGlobals();
      expect(Object.getOwnPropertyDescriptor(globalThis, "viUtilsDescriptor")).toEqual(descriptor);
    } finally {
      delete globalThis.viUtilsDescriptor;
    }
  });

  test("restoring does not read Object.prototype", () => {
    try {
      vi.stubGlobal("fetch", "stub");
      // @ts-expect-error
      Object.prototype.get = () => "polluted";
      vi.unstubAllGlobals();
    } finally {
      // @ts-expect-error
      delete Object.prototype.get;
    }
    expect(fetch).toBeFunction();
  });

  test("a global that is not configurable cannot be stubbed", () => {
    expect(() => vi.stubGlobal("undefined", 1)).toThrow(TypeError);
    expect(undefined).toBe(void 0);
    vi.unstubAllGlobals();
    expect(Object.getOwnPropertyDescriptor(globalThis, "undefined")).toEqual({
      value: undefined,
      writable: false,
      enumerable: false,
      configurable: false,
    });
  });

  test("a stub the test overwrote or deleted is still restored", () => {
    const original = fetch;
    vi.stubGlobal("fetch", "stub");
    // @ts-expect-error
    globalThis.fetch = "assigned";
    vi.stubGlobal("viUtilsNew", "stub");
    delete globalThis.viUtilsNew;
    vi.unstubAllGlobals();
    expect(fetch).toBe(original);
    expect("viUtilsNew" in globalThis).toBe(false);
  });

  test("the originals survive garbage collection", () => {
    try {
      Object.defineProperty(globalThis, "viUtilsDescriptor", { value: { marker: "original" }, configurable: true });
      vi.stubGlobal("viUtilsDescriptor", "stub");
      Bun.gc(true);
      vi.unstubAllGlobals();
      expect(globalThis.viUtilsDescriptor).toEqual({ marker: "original" });
    } finally {
      delete globalThis.viUtilsDescriptor;
    }
  });
});

describe.concurrent("stubs do not outlive their test file", () => {
  const files = {
    "a.test.ts": `
      import { expect, test, vi } from "bun:test";
      test("a", () => {
        expect([process.env.VI_UTILS_EXISTING, typeof fetch]).toEqual(["original", "function"]);
        vi.stubEnv("VI_UTILS_EXISTING", "stub");
        vi.stubEnv("VI_UTILS_NEW", "stub");
        vi.stubGlobal("fetch", "stub");
        vi.stubGlobal("viUtilsNew", "stub");
        expect([process.env.VI_UTILS_EXISTING, process.env.VI_UTILS_NEW, fetch, viUtilsNew]).toEqual(["stub", "stub", "stub", "stub"]);
      });
    `,
    "b.test.ts": `
      import { expect, test, vi } from "bun:test";
      test("b", () => {
        expect(process.env.VI_UTILS_EXISTING).toBe("original");
        expect("VI_UTILS_NEW" in process.env).toBe(false);
        expect(fetch).toBeFunction();
        expect("viUtilsNew" in globalThis).toBe(false);
      });
    `,
  };

  test.each(["--no-isolate", "--isolate", "--rerun-each=2", "--parallel=1 --no-isolate"])(
    "bun test %s",
    async flags => {
      const { stderr, exitCode } = await run(["test", ...flags.split(" "), "./a.test.ts", "./b.test.ts"], files, {
        VI_UTILS_EXISTING: "original",
      });
      expect({ results: [...new Set(results(stderr))], exitCode }).toEqual({
        results: ["(pass) a", "(pass) b"],
        exitCode: 0,
      });
    },
  );

  test("a file that fails to load", async () => {
    const { stderr, exitCode } = await run(
      ["test", "./a.test.ts", "./b.test.ts"],
      {
        ...files,
        "a.test.ts": `
          import { vi } from "bun:test";
          vi.stubEnv("VI_UTILS_EXISTING", "stub");
          vi.stubEnv("VI_UTILS_NEW", "stub");
          vi.stubGlobal("fetch", "stub");
          vi.stubGlobal("viUtilsNew", "stub");
          throw new Error("thrown while loading");
        `,
      },
      { VI_UTILS_EXISTING: "original" },
    );
    expect(stderr).toContain("error: thrown while loading");
    expect({ results: results(stderr), exitCode }).toEqual({ results: ["(pass) b"], exitCode: 1 });
  });
});

describe.concurrent("vi.setConfig", () => {
  test("testTimeout applies to the tests registered after it, until resetConfig", async () => {
    const { stderr, exitCode } = await run(["test", "./config.test.ts"], {
      "config.test.ts": `
        import { describe, expect, test, vi } from "bun:test";
        expect(vi.setConfig({ testTimeout: 10, hookTimeout: 10, unknown: true })).toBeUndefined();
        test("after setConfig", () => new Promise(() => {}));
        test("own timeout", () => Bun.sleep(40), 5000);
        expect(vi.resetConfig()).toBeUndefined();
        test("after resetConfig", () => Bun.sleep(40));
        test("setConfig in a test", () => vi.setConfig({ testTimeout: 10 }));
        test("registered before that test ran", () => Bun.sleep(40));
        describe("in describe", () => {
          vi.setConfig({ testTimeout: 10 });
          test("after setConfig", () => new Promise(() => {}));
          vi.setConfig({});
          test("after setConfig without testTimeout", () => new Promise(() => {}));
          vi.setConfig({ testTimeout: 0 });
          test("no timeout", () => Bun.sleep(40));
        });
      `,
    });
    expect(results(stderr)).toEqual([
      "(fail) after setConfig",
      "(pass) own timeout",
      "(pass) after resetConfig",
      "(pass) setConfig in a test",
      "(pass) registered before that test ran",
      "(fail) in describe > after setConfig",
      "(fail) in describe > after setConfig without testTimeout",
      "(pass) in describe > no timeout",
    ]);
    expect(stderr).toContain("timed out after 10ms");
    expect(exitCode).toBe(1);
  });

  test("does not reach the next file", async () => {
    const { stderr, exitCode } = await run(["test", "./a.test.ts", "./b.test.ts"], {
      "a.test.ts": `
        import { test, vi } from "bun:test";
        vi.setConfig({ testTimeout: 10 });
        test("a", () => {});
      `,
      "b.test.ts": `
        import { test } from "bun:test";
        test("b", () => Bun.sleep(40));
      `,
    });
    expect({ results: results(stderr), exitCode }).toEqual({ results: ["(pass) a", "(pass) b"], exitCode: 0 });
  });

  test("rejects a config that is not an object and a testTimeout that is not a number", () => {
    // @ts-expect-error
    expect(() => vi.setConfig()).toThrow('The "config" argument must be of type object. Received undefined');
    // @ts-expect-error
    expect(() => vi.setConfig({ testTimeout: "10" })).toThrow(
      `The "config.testTimeout" argument must be of type number. Received type string ('10')`,
    );
  });
});

describe.concurrent("vi.dynamicImportSettled", () => {
  test("waits for the imports in flight and the ones they start", async () => {
    const { stdout, stderr, exitCode } = await run(["test", "./settled.test.ts"], {
      "plain.ts": `console.log("plain evaluated");`,
      "nested.ts": `console.log("nested evaluated"); import("./nested2.ts").then(() => console.log("nested2 then"));`,
      "nested2.ts": `console.log("nested2 evaluated");`,
      "tla.ts": `console.log("tla start"); await Bun.sleep(20); console.log("tla end");`,
      "imports-tla.ts": `import "./tla2.ts"; console.log("imports-tla evaluated");`,
      "tla2.ts": `console.log("tla2 start"); await Bun.sleep(20); console.log("tla2 end");`,
      "gated.ts": `console.log("gated start"); await globalThis.gated(); console.log("gated end");`,
      "throws.ts": `console.log("throws evaluated"); throw new Error("thrown by the module");`,
      "cjs.cjs": `console.log("cjs evaluated");`,
      "plugin.ts": `
        Bun.plugin({
          name: "slow",
          setup(build) {
            build.onLoad({ filter: /\\.slow$/ }, async () => {
              console.log("slow onLoad");
              await Bun.sleep(20);
              return { contents: "console.log('slow evaluated')", loader: "js" };
            });
          },
        });
      `,
      "module.slow": ``,
      "settled.test.ts": `
        import { afterEach, expect, test, vi } from "bun:test";
        import "./plugin.ts";
        afterEach(() => console.log("--"));
        test("plain", async () => {
          import("./plain.ts").then(() => console.log("plain then")).then(() => {}).then(() => console.log("plain then then then"));
          expect(await vi.dynamicImportSettled()).toBeUndefined();
          console.log("settled");
        });
        test("nested", async () => {
          import("./nested.ts").then(() => console.log("nested then"));
          await vi.dynamicImportSettled();
          console.log("settled");
        });
        test("top-level await", async () => {
          import("./tla.ts").then(() => console.log("tla then"));
          await vi.dynamicImportSettled();
          console.log("settled");
        });
        test("top-level await in a dependency", async () => {
          import("./imports-tla.ts").then(() => console.log("imports-tla then"));
          await vi.dynamicImportSettled();
          console.log("settled");
        });
        test("throws", async () => {
          import("./throws.ts").catch(e => console.log("throws catch", e.message));
          await vi.dynamicImportSettled();
          console.log("settled");
        });
        test("missing", async () => {
          import("./" + "missing.ts").catch(() => console.log("missing catch"));
          await vi.dynamicImportSettled();
          console.log("settled");
        });
        test("commonjs", async () => {
          import("./cjs.cjs").then(() => console.log("cjs then"));
          await vi.dynamicImportSettled();
          console.log("settled");
        });
        test("asynchronous onLoad", async () => {
          import("./module.slow").then(() => console.log("slow then"));
          await vi.dynamicImportSettled();
          console.log("settled");
        });
        test("started by a timer that was set before the call", async () => {
          setTimeout(() => import("./plain.ts?timer").then(() => console.log("plain then")), 0);
          await vi.dynamicImportSettled();
          console.log("settled");
        });
        test("started by a timer while another import is in flight", async () => {
          const gate = Promise.withResolvers();
          globalThis.gated = () => {
            setTimeout(() => import("./plain.ts?gated").then(() => console.log("plain then")).then(gate.resolve), 1);
            return gate.promise;
          };
          import("./gated.ts").then(() => console.log("gated then"));
          await vi.dynamicImportSettled();
          console.log("settled");
        });
        test("two calls", async () => {
          import("./tla.ts?two").then(() => console.log("tla then"));
          await Promise.all([vi.dynamicImportSettled(), vi.dynamicImportSettled()]);
          console.log("settled");
        });
        test("nothing in flight", async () => {
          const ran = [];
          queueMicrotask(() => ran.push("microtask"));
          setImmediate(() => ran.push("immediate"));
          setTimeout(() => ran.push("timeout"), 0);
          await vi.dynamicImportSettled();
          console.log(...ran.sort());
        });
        test("fake timers", async () => {
          vi.useFakeTimers();
          try {
            import("./plain.ts?fake").then(() => console.log("plain then"));
            await vi.dynamicImportSettled();
            console.log("settled");
          } finally {
            vi.useRealTimers();
          }
        });
      `,
    });
    expect(stdout.split("\n--\n").map(lines => lines.split("\n").filter(line => !line.startsWith("bun test")))).toEqual(
      [
        ["plain evaluated", "plain then", "plain then then then", "settled"],
        ["nested evaluated", "nested then", "nested2 evaluated", "nested2 then", "settled"],
        ["tla start", "tla end", "tla then", "settled"],
        ["tla2 start", "tla2 end", "imports-tla evaluated", "imports-tla then", "settled"],
        ["throws evaluated", "throws catch thrown by the module", "settled"],
        ["missing catch", "settled"],
        ["cjs evaluated", "cjs then", "settled"],
        ["slow onLoad", "slow evaluated", "slow then", "settled"],
        ["plain evaluated", "plain then", "settled"],
        ["gated start", "plain evaluated", "plain then", "gated end", "gated then", "settled"],
        ["tla start", "tla end", "tla then", "settled"],
        ["immediate microtask timeout"],
        ["plain evaluated", "plain then", "settled"],
        [""],
      ],
    );
    expect(results(stderr).filter(line => !line.startsWith("(pass)"))).toEqual([]);
    expect(exitCode).toBe(0);
  });

  test("neither handles nor reports the rejection of an import", async () => {
    const { stderr, exitCode } = await run(["test", "./rejected.test.ts"], {
      "throws.ts": `throw new Error("thrown by the module");`,
      "rejected.test.ts": `
        import { expect, test, vi } from "bun:test";
        test("handled by the test", async () => {
          const message = import("./throws.ts?handled").catch(error => error.message);
          await vi.dynamicImportSettled();
          expect(await message).toBe("thrown by the module");
        });
        test("handled by nobody", async () => {
          import("./throws.ts?unhandled");
          await vi.dynamicImportSettled();
        });
      `,
    });
    expect(results(stderr)).toEqual(["(pass) handled by the test", "(fail) handled by nobody"]);
    expect(stderr.match(/error: thrown by the module/g)).toEqual(["error: thrown by the module"]);
    expect(exitCode).toBe(1);
  });

  test("an import that is in flight at the end of a test file is not the next file's", async () => {
    const { stdout, stderr, exitCode } = await run(["test", "./a.test.ts", "./b.test.ts"], {
      "never.ts": `await new Promise(() => {});`,
      "a.test.ts": `
        import { test } from "bun:test";
        test("a", () => void import("./never.ts"));
      `,
      "b.test.ts": `
        import { test, vi } from "bun:test";
        test("b", async () => {
          await vi.dynamicImportSettled();
          console.log("settled");
        });
      `,
    });
    expect({ stdout: stdout.split("\n").slice(1), results: results(stderr), exitCode }).toEqual({
      stdout: ["settled", ""],
      results: ["(pass) a", "(pass) b"],
      exitCode: 0,
    });
  });

  test.serial("does not retain the imports that have settled", async () => {
    await import("node:path");
    Bun.gc(true);
    const before = heapStats().objectTypeCounts.Promise ?? 0;
    for (let i = 0; i < 400; i++) await import("node:path");
    Bun.gc(true);
    expect((heapStats().objectTypeCounts.Promise ?? 0) - before).toBeLessThan(100);
  });
});

describe("vi.waitFor", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  test("resolves with the value of the first call that does not throw", async () => {
    let calls = 0;
    const promise = vi.waitFor(
      () => {
        if (++calls < 3) throw new Error("not yet");
        return "value " + calls;
      },
      { interval: 1 },
    );
    expect(promise).toBeInstanceOf(Promise);
    expect(calls).toBe(1);
    expect(await promise).toBe("value 3");
    expect(calls).toBe(3);
  });

  test.each([0, "", null, undefined, false, NaN])("%p is a value", async value => {
    const callback = vi.fn(() => value);
    expect(await vi.waitFor(callback)).toBe(value);
    expect(callback).toHaveBeenCalledTimes(1);
  });

  test("calls the callback without arguments or a receiver", async () => {
    const received = await vi.waitFor(function (this: unknown, ...args: unknown[]) {
      return [this, args];
    });
    expect(received).toEqual([undefined, []]);
  });

  test("rejects with the last error when it times out", async () => {
    const errors: Error[] = [];
    const promise = vi.waitFor(
      () => {
        errors.push(new Error("attempt " + (errors.length + 1)));
        throw errors.at(-1);
      },
      { timeout: 20, interval: 1 },
    );
    const error = await promise.then(
      () => "resolved",
      error => error,
    );
    expect(errors.length).toBeGreaterThan(1);
    expect(error).toBe(errors.at(-1));
  });

  test("a number is the timeout", async () => {
    const error = new Error("never");
    await expect(
      vi.waitFor(() => {
        throw error;
      }, 5),
    ).rejects.toBe(error);
  });

  test("rejects with a timeout error that points at the caller when there is no error", async () => {
    const callback = vi.fn(() => new Promise(() => {}));
    const error = await vi.waitFor(callback, { timeout: 10, interval: 1 }).then(
      () => "resolved",
      error => error,
    );
    expect(error).toBeInstanceOf(Error);
    expect(error.message).toBe("Timed out in waitFor!");
    expect(error.stack).toContain(import.meta.filename);
    expect(callback).toHaveBeenCalledTimes(1);
  });

  test.each([undefined, null, 0, "", false])("throwing %p is not an error to report", async value => {
    await expect(
      vi.waitFor(
        () => {
          throw value;
        },
        { timeout: 5, interval: 1 },
      ),
    ).rejects.toThrow("Timed out in waitFor!");
  });

  test("an async callback is not called again while its promise is pending", async () => {
    let calls = 0;
    let active = 0;
    let mostActive = 0;
    const value = await vi.waitFor(
      async () => {
        calls++;
        mostActive = Math.max(mostActive, ++active);
        await Bun.sleep(5);
        active--;
        if (calls < 3) throw new Error("not yet");
        return calls;
      },
      { interval: 1 },
    );
    expect({ value, calls, mostActive }).toEqual({ value: 3, calls: 3, mostActive: 1 });
  });

  test("rejects with the last rejection when it times out", async () => {
    const errors: Error[] = [];
    const error = await vi
      .waitFor(
        async () => {
          errors.push(new Error("attempt " + (errors.length + 1)));
          throw errors.at(-1);
        },
        { timeout: 20, interval: 1 },
      )
      .then(
        () => "resolved",
        error => error,
      );
    expect(errors.length).toBeGreaterThan(1);
    expect(error).toBe(errors.at(-1));
  });

  test("a promise that settles after the timeout is ignored", async () => {
    const { promise, resolve } = Promise.withResolvers();
    await expect(vi.waitFor(() => promise, { timeout: 5, interval: 1 })).rejects.toThrow("Timed out in waitFor!");
    resolve("late");
    await promise;
  });

  test("waits for any thenable", async () => {
    expect(
      await vi.waitFor<unknown>(() => ({ then: (resolve: (value: string) => void) => resolve("synchronous") })),
    ).toBe("synchronous");
    expect(
      await vi.waitFor<unknown>(() => ({
        then: (resolve: (value: string) => void) => void setImmediate(resolve, "later"),
      })),
    ).toBe("later");

    let calls = 0;
    const value = await vi.waitFor<unknown>(
      () => ({
        then(resolve: (value: number) => void, reject: (error: Error) => void) {
          if (++calls < 3) reject(new Error("not yet"));
          else resolve(calls);
          resolve(-1);
          reject(new Error("ignored"));
        },
      }),
      { interval: 1 },
    );
    expect(value).toBe(3);
  });

  test("a `then` that throws is a failed attempt", async () => {
    let calls = 0;
    const value = await vi.waitFor<unknown>(
      () => ({
        get then() {
          if (++calls === 1) throw new Error("getter");
          return (resolve: (value: number) => void) => {
            if (calls === 2) throw new Error("call");
            resolve(calls);
          };
        },
      }),
      { interval: 1 },
    );
    expect(value).toBe(3);
  });

  test("a function with a `then` is a value, which the promise adopts", async () => {
    const callable = Object.assign(() => {}, { then: (resolve: (value: string) => void) => resolve("adopted") });
    expect(await vi.waitFor<unknown>(() => callable)).toBe("adopted");
  });

  test("delays are coerced as setTimeout coerces them", async () => {
    for (const timeout of [0, -1, NaN, Infinity, 2 ** 31]) {
      const callback = vi.fn(() => {
        throw new Error("timeout " + timeout);
      });
      await expect(vi.waitFor(callback, { timeout, interval: 1000 })).rejects.toThrow("timeout " + timeout);
      expect(callback).toHaveBeenCalledTimes(1);
    }
    let calls = 0;
    // @ts-expect-error
    await vi.waitFor(() => expect(++calls).toBe(3), { timeout: "1000", interval: { valueOf: () => 0 } });
  });

  test("reads the options once, in order, before it calls the callback", async () => {
    const order: string[] = [];
    await vi.waitFor(() => void order.push("callback"), {
      get timeout() {
        order.push("timeout");
        return 100;
      },
      get interval() {
        order.push("interval");
        return 1;
      },
    });
    expect(order).toEqual(["interval", "timeout", "callback"]);
  });

  test("rejects invalid arguments", () => {
    // @ts-expect-error
    expect(() => vi.waitFor()).toThrow('The "callback" argument must be of type function. Received undefined');
    // @ts-expect-error
    expect(() => vi.waitFor({})).toThrow(
      'The "callback" argument must be of type function. Received an instance of Object',
    );
    const callback = vi.fn();
    // @ts-expect-error
    expect(() => vi.waitFor(callback, null)).toThrow(
      'The "options" argument must be one of type number or object. Received null',
    );
    // @ts-expect-error
    expect(() => vi.waitFor(callback, "10")).toThrow(
      `The "options" argument must be one of type number or object. Received type string ('10')`,
    );
    expect(() => vi.waitFor(callback, { interval: Symbol() as any })).toThrow(TypeError);
    expect(callback).not.toHaveBeenCalled();
  });

  test("does not need `vi` as its receiver", async () => {
    const { waitFor } = vi;
    expect(await waitFor(() => "value")).toBe("value");
    expect({ name: waitFor.name, length: waitFor.length }).toEqual({ name: "waitFor", length: 1 });
  });

  test("every call runs in the async context of the caller", async () => {
    const storage = new AsyncLocalStorage<string>();
    const stores: unknown[] = [];
    await storage.run("caller", () =>
      vi.waitFor(
        () => {
          stores.push(storage.getStore());
          if (stores.length < 3) throw new Error("not yet");
        },
        { interval: 1 },
      ),
    );
    expect(stores).toEqual(["caller", "caller", "caller"]);
  });

  test("waits can be nested and run side by side", async () => {
    const values = await Promise.all(
      Array.from({ length: 20 }, (_, i) => {
        let calls = 0;
        return vi.waitFor(
          async () => {
            if (++calls < 3) throw new Error("not yet");
            return vi.waitFor(() => i, { interval: 1 });
          },
          { interval: 1 },
        );
      }),
    );
    expect(values).toEqual(Array.from({ length: 20 }, (_, i) => i));
  });

  test("a pending wait survives garbage collection", async () => {
    let calls = 0;
    const value = await vi.waitFor(
      () => {
        Bun.gc(true);
        if (++calls < 4) throw new Error("attempt " + calls);
        return { calls };
      },
      { interval: 1 },
    );
    expect(value).toEqual({ calls: 4 });

    const error = await vi
      .waitFor(
        async () => {
          Bun.gc(true);
          throw new Error("rejected");
        },
        { interval: 1, timeout: 10 },
      )
      .then(
        () => "resolved",
        error => (Bun.gc(true), error),
      );
    expect(error.message).toBe("rejected");
  });

  test("a wait that has settled is collected", async () => {
    const settled = await Promise.allSettled(
      Array.from({ length: 100 }, (_, i) => {
        let calls = 0;
        const attempt = () => {
          if (++calls < 3) throw new Error("not yet");
        };
        return [
          () => vi.waitFor(() => {}),
          () => vi.waitFor(attempt, { interval: 1 }),
          () => vi.waitFor(async () => attempt(), { interval: 1 }),
          () => vi.waitFor(() => expect.unreachable(), { interval: 1, timeout: 5 }),
          () => vi.waitUntil(() => new Promise(() => {}), { interval: 1, timeout: 5 }),
        ][i % 5]();
      }),
    );
    expect(settled.filter(({ status }) => status === "fulfilled")).toHaveLength(60);
    Bun.gc(true);
    expect(heapStats().objectTypeCounts.ViWait).toBeLessThan(10);
  });

  describe("with fake timers", () => {
    test("polls on real time and advances the fake clock by the interval before every call", async () => {
      vi.useFakeTimers();
      const start = Date.now();
      const events: [string, number][] = [];
      let fired = false;
      setTimeout(() => {
        fired = true;
        events.push(["timer", Date.now() - start]);
      }, 200);
      await vi.waitFor(
        () => {
          events.push(["callback", Date.now() - start]);
          if (!fired) throw new Error("not yet");
        },
        { interval: 50 },
      );
      expect(events).toEqual([
        ["callback", 50],
        ["callback", 100],
        ["callback", 150],
        ["timer", 200],
        ["callback", 200],
      ]);
      expect(Date.now() - start).toBe(200);
    });

    test("keeps advancing while the callback's promise is pending", async () => {
      vi.useFakeTimers();
      const start = Date.now();
      const callback = vi.fn(() => new Promise(resolve => setTimeout(resolve, 100, "fake timer")));
      expect(await vi.waitFor(callback, { interval: 20 })).toBe("fake timer");
      expect(callback).toHaveBeenCalledTimes(1);
      expect(Date.now() - start).toBe(120);
    });

    test("times out on real time", async () => {
      vi.useFakeTimers();
      await expect(
        vi.waitFor(
          () => {
            throw new Error("never");
          },
          { interval: 1, timeout: 10 },
        ),
      ).rejects.toThrow("never");
    });

    test("notices fake timers that are switched on or off while it waits", async () => {
      let calls = 0;
      let start = 0;
      const elapsed: number[] = [];
      await vi.waitFor(
        () => {
          calls++;
          if (calls === 2) {
            vi.useFakeTimers();
            start = Date.now();
          }
          if (calls > 2) elapsed.push(Date.now() - start);
          if (calls === 4) vi.useRealTimers();
          if (calls < 6) throw new Error("not yet");
        },
        { interval: 10 },
      );
      expect(elapsed.slice(0, 2)).toEqual([10, 20]);
    });

    test("rejects with what a fake timer throws in the advance before the first call", async () => {
      vi.useFakeTimers();
      setTimeout(() => {
        throw new Error("thrown by a fake timer");
      }, 10);
      const callback = vi.fn();
      await expect(vi.waitFor(callback, { interval: 10 })).rejects.toThrow("thrown by a fake timer");
      expect(callback).not.toHaveBeenCalled();
    });
  });
});

describe("vi.waitUntil", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  test("resolves with the first truthy value", async () => {
    const values = [0, "", null, undefined, false, NaN, "truthy", "unused"];
    const callback = vi.fn(() => values.shift());
    expect(await vi.waitUntil(callback, { interval: 1 })).toBe("truthy");
    expect(callback).toHaveBeenCalledTimes(7);
  });

  test("resolves with the first truthy value of an async callback", async () => {
    let calls = 0;
    expect(await vi.waitUntil(async () => (++calls < 3 ? null : calls), { interval: 1 })).toBe(3);
  });

  test("an error rejects at once and ends the wait", async () => {
    const error = new Error("thrown");
    const callback = vi.fn(() => {
      throw error;
    });
    await expect(vi.waitUntil(callback, { interval: 1 })).rejects.toBe(error);
    let polls = 0;
    await vi.waitFor(() => expect(++polls).toBe(10), { interval: 1 });
    expect(callback).toHaveBeenCalledTimes(1);
  });

  test("a rejection rejects at once and ends the wait", async () => {
    const error = new Error("rejected");
    let calls = 0;
    const callback = vi.fn(async () => {
      if (++calls === 2) throw error;
      return false;
    });
    await expect(vi.waitUntil(callback, { interval: 1 })).rejects.toBe(error);
    let polls = 0;
    await vi.waitFor(() => expect(++polls).toBe(10), { interval: 1 });
    expect(callback).toHaveBeenCalledTimes(2);
  });

  test("rejects with exactly what was thrown", async () => {
    await expect(
      vi.waitUntil(() => {
        throw 0;
      }),
    ).rejects.toBe(0);
  });

  test("rejects with a timeout error that points at the caller", async () => {
    for (const callback of [() => false, async () => false, () => new Promise(() => {})]) {
      const error = await vi.waitUntil(callback, { timeout: 10, interval: 1 }).then(
        () => "resolved",
        error => error,
      );
      expect(error).toBeInstanceOf(Error);
      expect(error.message).toBe("Timed out in waitUntil!");
      expect(error.stack).toContain(import.meta.filename);
    }
    await expect(vi.waitUntil(() => false, 5)).rejects.toThrow("Timed out in waitUntil!");
  });

  test("advances fake timers", async () => {
    vi.useFakeTimers();
    const start = Date.now();
    let fired = false;
    setTimeout(() => (fired = true), 100);
    expect(await vi.waitUntil(() => fired, { interval: 25 })).toBe(true);
    expect(Date.now() - start).toBe(100);
  });

  test("rejects invalid arguments", () => {
    // @ts-expect-error
    expect(() => vi.waitUntil("callback")).toThrow(
      `The "callback" argument must be of type function. Received type string ('callback')`,
    );
    // @ts-expect-error
    expect(() => vi.waitUntil(() => true, true)).toThrow(
      'The "options" argument must be one of type number or object. Received type boolean (true)',
    );
    expect({ name: vi.waitUntil.name, length: vi.waitUntil.length }).toEqual({ name: "waitUntil", length: 1 });
  });
});

describe.concurrent("a wait that is still pending", () => {
  const files = {
    "a.test.ts": `
      import { test, vi } from "bun:test";
      globalThis.calls = 0;
      test("a", () => {
        const called = () => {
          globalThis.calls++;
          console.log("called");
        };
        const throws = () => {
          called();
          throw new Error("left behind by a.test.ts");
        };
        vi.waitFor(throws, { interval: 1, timeout: 20 });
        for (let i = 0; i < 20; i++) {
          vi.waitFor(throws, { interval: 1, timeout: 1_000_000 });
          vi.waitUntil(called, { interval: 1, timeout: 1_000_000 });
        }
        vi.waitUntil(() => (called(), new Promise(() => {})), { interval: 1, timeout: 20 });
      });
    `,
    "b.test.ts": `
      import { heapStats } from "bun:jsc";
      import { expect, test, vi } from "bun:test";
      test("b", async () => {
        const before = globalThis.calls;
        console.log("b");
        let polls = 0;
        await vi.waitFor(() => expect(++polls).toBe(40), { interval: 1 });
        expect(globalThis.calls).toBe(before);
        Bun.gc(true);
        expect(heapStats().objectTypeCounts.ViWait).toBeLessThan(10);
      });
    `,
  };

  test.each(["--no-isolate", "--isolate", "--parallel=1 --no-isolate"])(
    "ends with its test file: bun test %s",
    async flags => {
      const { stdout, stderr, exitCode } = await run(
        ["test", ...flags.split(" "), "./a.test.ts", "./b.test.ts"],
        files,
      );
      expect(stderr).not.toContain("left behind");
      expect(stderr).not.toContain("Timed out");
      expect(stdout.slice(stdout.indexOf("b\n"))).toBe("b\n");
      expect({ results: results(stderr), exitCode }).toEqual({ results: ["(pass) a", "(pass) b"], exitCode: 0 });
    },
  );

  test("goes on after a fake timer throws, which is an uncaught error", async () => {
    const { stdout, stderr, exitCode } = await run(["test", "./throws.test.ts"], {
      "throws.test.ts": `
        import { test, vi } from "bun:test";
        let wait;
        test("throws", async () => {
          vi.useFakeTimers();
          setTimeout(() => {
            throw new Error("thrown by a fake timer");
          }, 15);
          let calls = 0;
          wait = vi.waitFor(() => { if (++calls < 4) throw new Error("not yet"); return calls; }, { interval: 10 });
          await wait;
        });
        test("goes on", async () => {
          console.log("calls:", await wait);
        });
      `,
    });
    expect(stderr).toContain("error: thrown by a fake timer");
    expect({ stdout: stdout.split("\n").slice(1), results: results(stderr), exitCode }).toEqual({
      stdout: ["calls: 4", ""],
      results: ["(fail) throws", "(pass) goes on"],
      exitCode: 1,
    });
  });

  test("keeps a process that is not a test runner alive", async () => {
    const { stdout, stderr, exitCode } = await run(["./script.ts"], {
      "script.ts": `
        import { vi } from "bun:test";
        let calls = 0;
        vi.waitFor(() => { if (++calls < 3) throw new Error("not yet"); return calls; }, { interval: 1 }).then(console.log);
        vi.waitUntil(() => false, { interval: 1, timeout: 5 }).catch(error => console.log(error.message));
      `,
    });
    expect({ stdout: stdout.split("\n").sort(), stderr, exitCode }).toEqual({
      stdout: ["", "3", "Timed out in waitUntil!"],
      stderr: "",
      exitCode: 0,
    });
  });

  test("does not outlive a worker", async () => {
    const { stdout, exitCode } = await run(["./script.ts"], {
      "worker.ts": `
        import { vi } from "bun:test";
        vi.waitFor(() => { throw new Error("never"); }, { interval: 1, timeout: 1_000_000 });
        postMessage("waiting");
      `,
      "script.ts": `
        const worker = new Worker("./worker.ts");
        await new Promise(resolve => (worker.onmessage = resolve));
        await worker.terminate();
        console.log("terminated");
      `,
    });
    expect({ stdout, exitCode }).toEqual({ stdout: "terminated\n", exitCode: 0 });
  });
});

// A native function is given the raw `this` of a call. When the function is called by a bare name that is not a
// local variable, that is the engine's own scope object, which holds the variables of the scope the name is in.
describe("a function that returns `this` for chaining", () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  /** `callee` is a variable of this call's scope, which the arrow function finds it in. */
  const byBareName = (callee: Function, ...args: unknown[]) => (() => callee(...args))();

  const ofViAndJest: [name: string, ...args: unknown[]][] = [
    ["useFakeTimers"],
    ["useRealTimers"],
    ["setSystemTime", 0],
    ["advanceTimersByTime", 1],
    ["advanceTimersToNextTimer"],
    ["advanceTimersToNextFrame"],
    ["runOnlyPendingTimers"],
    ["runAllTimers"],
    ["runAllTicks"],
    ["runAllImmediates"],
    ["setTimerTickMode", "manual"],
    ["clearAllTimers"],
    ["clearAllMocks"],
    ["resetAllMocks"],
    ["restoreAllMocks"],
  ];
  const rows = (
    [
      ...ofViAndJest.map(row => ["vi", vi, ...row]),
      ...ofViAndJest.map(row => ["jest", jest, ...row]),
      ["vi", vi, "stubGlobal", "viUtilsCalledByBareName", 1],
      ["vi", vi, "unstubAllGlobals"],
      ["vi", vi, "stubEnv", "VI_UTILS_CALLED_BY_BARE_NAME", "1"],
      ["vi", vi, "unstubAllEnvs"],
      ["jest", jest, "mock", "vi-utils-called-by-bare-name", () => ({})],
      ["jest", jest, "doMock", "vi-utils-called-by-bare-name", () => ({})],
      ["jest", jest, "unmock", "vi-utils-called-by-bare-name"],
      ["jest", jest, "dontMock", "vi-utils-called-by-bare-name"],
      ["mock", mock, "restore"],
      ["mock", mock, "clearAllMocks"],
    ] as [owner: string, object: object, name: string, ...args: unknown[]][]
  ).map(([owner, object, name, ...args]) => [`${owner}.${name}`, owner, object, name, args] as const);

  test.each(rows)("%s() returns %s, and undefined when it is called by a bare name", (_, __, object, name, args) => {
    vi.useFakeTimers();
    expect(object[name](...args)).toBe(object);
    vi.useFakeTimers();
    expect(byBareName(object[name], ...args)).toBeUndefined();
  });

  test.each([
    ["advanceTimersByTimeAsync", 1],
    ["advanceTimersToNextTimerAsync"],
    ["runAllTimersAsync"],
    ["runOnlyPendingTimersAsync"],
  ] as const)(
    "vi.%s() resolves with vi, and with undefined when it is called by a bare name",
    async (name, ...args) => {
      vi.useFakeTimers();
      expect(await (vi[name] as Function)(...args)).toBe(vi);
      expect(await byBareName(vi[name], ...args)).toBeUndefined();
    },
  );

  test("setSystemTime() that is imported returns undefined", () => {
    expect(setSystemTime(0)).toBeUndefined();
    expect(setSystemTime()).toBeUndefined();
  });

  test("the getter of mock.settledResults does not read the variables of a scope", () => {
    const getter = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(vi.fn().mock), "settledResults")!.get!;
    // The getter reads `this.results`.
    const results = [{ type: "return", value: "a variable, not a result" }];
    expect((() => [getter(), results.length])()).toEqual([undefined, 1]);
  });

  // Hundreds of calls, most of which throw: seconds in a debug build that validates exception checks.
  test.concurrent(
    "no function of the test module lets a scope object out",
    async () => {
      const { stdout, stderr, exitCode } = await run(["test", "--timeout=60000", "./sweep.test.ts"], {
        "sweep.test.ts": `
        import * as bunTest from "bun:test";
        import * as vitest from "vitest";
        import * as jestGlobals from "@jest/globals";

        const byBareName = (callee, ...args) => (() => callee(...args))();
        const isInternal = value =>
          value !== null && ["object", "function"].includes(typeof value) && Bun.inspect(value).startsWith("[native code");
        const turn = () => new Promise(resolve => setImmediate(resolve, "pending"));

        bunTest.test("sweep", async () => {
          const escaped = [];
          const swept = new Set();
          let calls = 0;
          async function sweep(path, object) {
            for (const [name, callee] of Object.entries(object)) {
              // What expectTypeOf() returns has every property.
              if (typeof callee !== "function" || name === "expectTypeOf" || swept.has(callee)) continue;
              swept.add(callee);
              for (const fake of [false, true]) {
                for (const args of [[], [0], ["sweep", 1]]) {
                  if (bunTest.vi.isFakeTimers() !== fake) fake ? bunTest.vi.useFakeTimers() : bunTest.vi.useRealTimers();
                  let result;
                  try {
                    result = byBareName(callee, ...args);
                  } catch {
                    continue;
                  }
                  calls++;
                  if (result instanceof Promise) result = await Promise.race([result.catch(error => error), turn()]);
                  if (isInternal(result)) escaped.push(path + "." + name + "(" + args + ")");
                }
              }
            }
          }
          for (const [from, module] of Object.entries({ "bun:test": bunTest, vitest, "@jest/globals": jestGlobals })) {
            await sweep(from, module);
            for (const name of ["vi", "jest", "mock"]) if (module[name]) await sweep(from + "." + name, module[name]);
          }
          bunTest.vi.useRealTimers();
          console.log(JSON.stringify({ escaped, swept: calls > 100 }));
        });
      `,
      });
      expect({ stdout: stdout.replace(/^bun test .*\n/, ""), exitCode }, stderr).toEqual({
        stdout: '{"escaped":[],"swept":true}\n',
        exitCode: 0,
      });
    },
    60_000,
  );
});
