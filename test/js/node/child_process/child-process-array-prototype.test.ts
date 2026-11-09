import { afterAll, describe, expect, it } from "bun:test";
import { bunEnv, bunExe, isWindows, tempDir } from "harness";
import { ChildProcess, execFile, execFileSync, spawn } from "node:child_process";
import { once } from "node:events";
import { text } from "node:stream/consumers";

// A child gets the argv, the command line, the stdio and the environment that the caller passed, whatever a script stored on
// Array.prototype. Each case runs in a process of its own.
describe("what a script stored on Array.prototype", () => {
  const files = {
    // Windows has no /bin/echo.
    "echo.cjs": `process.stdout.write(process.argv.slice(2).join(" ") + "\\n");`,
    "ipc-child.cjs": `process.on("message", message => process.send("child got " + message, () => process.disconnect()));`,
    // Prints the same under Node v26.12.1, in each of the three orders.
    "replaced-functions.cjs": /* js */ `
      const [order, calls_] = process.argv.slice(2);
      const windows = process.platform === "win32";
      const echo = windows ? process.execPath : "/bin/echo";
      const echoed = (...words) => (windows ? [__dirname + "\\\\echo.cjs", ...words] : words);
      const withAHole = () => (windows ? [__dirname + "\\\\echo.cjs", , "last"] : ["intended", , "last"]);
      const stringify = JSON.stringify;
      const apply = Reflect.apply;
      const keys = Object.keys;
      const indexes = list => keys(list).length + " of " + list.length;
      // The children get this copy: the walk over process.env is not what this is about.
      const env = { ...process.env, REPLACED_ARRAY_FUNCTIONS: "in the environment" };
      // Every function of Array.prototype but the array iterator, which Node reads for the names of the environment. On
      // Windows the list of those names still goes through kept copies of filter() and sort().
      const names = Reflect.ownKeys(Array.prototype).filter(
        name =>
          typeof Array.prototype[name] === "function" &&
          name !== "constructor" &&
          Array.prototype[name] !== Array.prototype[Symbol.iterator] &&
          !(windows && (name === "filter" || name === "sort")),
      );
      const real = names.map(name => Array.prototype[name]);
      const calls = {};
      // True inside watch(). True for good once the functions are restored: only a copy that a module kept reaches a
      // replacement then.
      let watching = false;

      function install() {
        for (let i = 0; i < names.length; i++) {
          const name = names[i];
          const original = real[i];
          Array.prototype[name] = function (...args) {
            if (!watching) return apply(original, this, args);
            calls[String(name)] = (calls[String(name)] || 0) + 1;
            // What a spy answers once it is restored.
            return undefined;
          };
        }
      }

      function restore() {
        for (let i = 0; i < names.length; i++) Array.prototype[names[i]] = real[i];
      }

      function watch(call) {
        const was = watching;
        watching = true;
        try {
          return call();
        } finally {
          watching = was;
        }
      }

      function outputOf(child) {
        let out = "";
        child.stdout.on("data", chunk => (out += chunk));
        return new Promise(resolve => child.on("close", () => resolve(out)));
      }

      function useSync(cp) {
        const result = {};
        result.spawnSync = String(watch(() => cp.spawnSync(echo, echoed("intended", "last"), { env })).stdout);
        const printsVariable = windows ? "echo %REPLACED_ARRAY_FUNCTIONS%" : "echo $REPLACED_ARRAY_FUNCTIONS";
        result.shell = String(watch(() => cp.spawnSync(printsVariable, { env, shell: true })).stdout).trim();
        if (!windows) {
          // join() takes null as "".
          const words = ["intended", null, "last"];
          result.shellWithArgs = String(watch(() => cp.spawnSync(echo, words, { env, shell: true })).stdout);
        }
        result.execFileSync = watch(() => cp.execFileSync(echo, echoed("intended", "last"), { env, encoding: "utf8" }));
        try {
          watch(() => cp.spawnSync(echo, ["first", "l\\0ast"], { env }));
        } catch (error) {
          result.nullByte = error.code + ": " + error.message;
        }
        try {
          watch(() => cp.spawn(echo, [], { env, stdio: ["ignore", "ignore", "ignore", "ipc", "ipc"] }));
        } catch (error) {
          result.twoIpcSlots = error.code;
        }
        return result;
      }

      async function useAsync(cp) {
        const result = {};
        // The call is not watched while the functions are replaced: execFile() sets the encoding of its streams, and
        // setEncoding() of Node calls slice().
        result.execFile = await new Promise(resolve => {
          const child = cp.execFile(echo, withAHole(), { env, encoding: "utf8" }, (error, stdout) =>
            resolve(indexes(child.spawnargs) + ": " + (error ? String(error) : stdout)),
          );
        });
        result.fork = await new Promise(resolve => {
          const options = { env, stdio: ["ignore", "ignore", "inherit", "ipc"] };
          const child = watch(() => cp.fork(__dirname + (windows ? "\\\\" : "/") + "ipc-child.cjs", [], options));
          child.on("message", resolve);
          child.send("a message");
        });
        result.spawn = await outputOf(watch(() => cp.spawn(echo, echoed("intended", "last"), { env })));
        const fourPipes = { env, stdio: ["pipe", "pipe", "pipe", "pipe"] };
        result.spawnWithFourthPipe = await outputOf(watch(() => cp.spawn(echo, echoed("intended", "last"), fourPipes)));
        const holey = watch(() => cp.spawn(echo, withAHole(), { env }));
        result.spawnWithAHole = indexes(holey.spawnargs) + ": " + (await outputOf(holey));
        // What is behind the first "=" of a pair is the value.
        const printsPair = windows ? [process.execPath, "-p", "process.env.PAIR"] : ["/bin/sh", "-c", "echo $PAIR"];
        const direct = new cp.ChildProcess();
        const pairs = { file: printsPair[0], args: printsPair, envPairs: ["PAIR=a=b=c"], stdio: ["ignore", "pipe", "inherit"] };
        watch(() => direct.spawn(pairs));
        result.envPairs = (await outputOf(direct)).trim();
        return result;
      }

      (async () => {
        const use = calls_ === "the calls that wait for the child" ? useSync : useAsync;
        let cp;
        if (order === "before node:child_process loads") {
          install();
          cp = require("node:child_process");
        } else if (order === "only while node:child_process loads and is first used") {
          install();
          cp = require("node:child_process");
          await use(cp);
          restore();
          watching = true;
        } else if (order === "after the first use of node:child_process") {
          cp = require("node:child_process");
          await use(cp);
          install();
        } else throw new Error("unknown order: " + order);
        const result = await use(cp);
        watching = false;
        restore();
        console.log(stringify({ result, calls }));
      })();
    `,
    "a.test.js": /* js */ `
      import { expect, mock, spyOn, test } from "bun:test";

      test("spies are on while node:child_process first loads and runs", () => {
        for (const name of ["slice", "unshift", "push", "join", "includes"]) spyOn(Array.prototype, name);
        const { spawnSync } = require("node:child_process");
        expect(spawnSync(process.execPath, ["-e", ""]).status).toBe(0);
        mock.restore();
      });
    `,
    "b.test.js": /* js */ `
      import { expect, test } from "bun:test";
      import { execFileSync, spawn, spawnSync } from "node:child_process";
      import { join } from "node:path";

      const echo = process.platform === "win32" ? process.execPath : "/bin/echo";
      const echoed = process.platform === "win32" ? [join(import.meta.dir, "echo.cjs"), "from", "b"] : ["from", "b"];

      test("spawnSync() and execFileSync() in a later file", () => {
        expect(String(spawnSync(echo, echoed).stdout)).toBe("from b\\n");
        expect(execFileSync(echo, echoed, { encoding: "utf8" })).toBe("from b\\n");
      });

      test("spawn() in a later file", async () => {
        const child = spawn(echo, echoed);
        let out = "";
        child.stdout.on("data", chunk => (out += chunk));
        await new Promise(resolve => child.on("close", resolve));
        expect(out).toBe("from b\\n");
      });
    `,
    // The script of https://github.com/oven-sh/bun/issues/42723, with commands whose output shows what ran.
    "index-setter.cjs": /* js */ `
      const { exec, spawnSync } = require("node:child_process");
      const windows = process.platform === "win32";
      Object.defineProperty(Array.prototype, "2", { set() {}, configurable: true });
      const sync = spawnSync(
        windows ? process.execPath : "/bin/echo",
        windows ? [__dirname + "\\\\echo.cjs", "a", "b", "c"] : ["a", "b", "c"],
      );
      const child = exec("echo the command ran", (error, stdout) => {
        delete Array.prototype[2];
        // cmd.exe ends its line with "\\r\\n".
        process.stdout.write(String(sync.stdout).trim() + "\\n" + (error ? String(error) : stdout.trim()) + "\\n" + stdio + "\\n");
      });
      const stdio = "child.stdio[2] is child.stderr: " + (child.stdio[2] === child.stderr && child.stdio.length === 3);
    `,
    "throwing-iterator.cjs": /* js */ `
      const windows = process.platform === "win32";
      const echo = windows ? process.execPath : "/bin/echo";
      const echoed = word => (windows ? [__dirname + "\\\\echo.cjs", word] : [word]);
      const env = { ...process.env };
      const realIterator = Array.prototype[Symbol.iterator];
      const throwing = function () {
        throw new Error("the array iterator was called");
      };

      if (process.argv[2] === "while node:child_process first loads") {
        Array.prototype[Symbol.iterator] = throwing;
        let out;
        try {
          out = String(require("node:child_process").spawnSync(echo, echoed("the child ran"), { env }).stdout);
        } catch (error) {
          out = String(error) + "\\n";
        }
        Array.prototype[Symbol.iterator] = realIterator;
        process.stdout.write(out);
      } else {
        const cp = require("node:child_process");
        // The child writes to this process's stdout, so what reads that stdout to its end knows whether a child ran.
        const stdio = ["pipe", "inherit", "pipe", "pipe"].slice(0, Number(process.argv[2]));
        const envPairs = Object.keys(env).map(name => name + "=" + env[name]);
        // The first child loads the modules of the streams.
        cp.execFile(echo, echoed("the first child ran"), { env }, () => {
          Array.prototype[Symbol.iterator] = throwing;
          let promised;
          try {
            cp.spawn(echo, echoed("the child ran"), { env, stdio });
            process.stdout.write("spawn() returned\\n");
            const direct = { file: echo, args: [echo].concat(echoed("the child with envPairs ran")), envPairs, stdio };
            new cp.ChildProcess().spawn(direct);
            promised = require("node:util").promisify(cp.execFile)(echo, echoed("the promised child ran"), { env });
          } catch (error) {
            process.stdout.write(String(error) + "\\n");
          }
          Array.prototype[Symbol.iterator] = realIterator;
          promised?.then(({ stdout }) => process.stdout.write(stdout));
        });
      }
    `,
    "perf-hooks-under-a-throwing-iterator.cjs": /* js */ `
      const realIterator = Array.prototype[Symbol.iterator];
      Array.prototype[Symbol.iterator] = function () {
        throw new Error("the array iterator was called");
      };
      let out;
      try {
        out = "node:perf_hooks loaded, performance.now is a " + typeof require("node:perf_hooks").performance.now;
      } catch (error) {
        out = String(error);
      }
      Array.prototype[Symbol.iterator] = realIterator;
      process.stdout.write(out + "\\n");

      // A "function" entry comes from the registry of Node's own types, whatever includes() answers.
      const { PerformanceObserver, performance } = require("node:perf_hooks");
      const observer = new PerformanceObserver(list => {
        process.stdout.write("observed: " + list.getEntries()[0].entryType + "\\n");
        observer.disconnect();
      });
      const realIncludes = Array.prototype.includes;
      Array.prototype.includes = () => false;
      observer.observe({ entryTypes: ["function"] });
      Array.prototype.includes = realIncludes;
      performance.timerify(function timed() {})();
    `,
    // Prints once its stdin ends, which is when the process that started it is gone.
    "outlives.cjs": `process.stdin.on("end", () => process.stdout.write("the child outlived spawn()\\n")).resume();`,
    "throws-after-the-child-started.cjs": /* js */ `
      const cp = require("node:child_process");
      const { writeSync } = require("node:fs");
      const why = process.argv[2];
      const env = { ...process.env };
      // The child holds this process's stdout, and prints there once its stdin ends.
      const stdio = ["pipe", "inherit", "pipe"];
      const waits =
        process.platform === "win32"
          ? [process.execPath, __dirname + "\\\\outlives.cjs"]
          : ["/bin/sh", "-c", "read line; echo 'the child outlived spawn()'"];
      // The child runs once the native spawn has returned.
      let childRuns = false;
      const nativeSpawn = Bun.spawn;
      Bun.spawn = function (options) {
        const handle = nativeSpawn.call(this, options);
        childRuns = true;
        if (why === "process.nextTick throws, and then kill() throws") {
          const kill = handle.kill.bind(handle);
          handle.kill = signal => {
            kill(signal);
            throw new Error("kill() failed");
          };
        }
        return handle;
      };
      const realNextTick = process.nextTick;
      if (why === "the modules of the streams cannot load") {
        // They cannot under this iterator, and it stays: what fails in spawn() fails again in whatever touches the streams later.
        Array.prototype[Symbol.iterator] = function () {
          throw new Error("the array iterator was called");
        };
      } else {
        // spawn() calls process.nextTick() once the child runs.
        process.nextTick = () => {
          throw new Error("process.nextTick was called");
        };
      }
      let threw = "nothing";
      try {
        cp.spawn(waits[0], waits.slice(1), { env, stdio });
      } catch (error) {
        threw = error.message;
      }
      process.nextTick = realNextTick;
      writeSync(1, "spawn() threw: " + threw + ", " + (childRuns ? "after" : "before") + " the child started\\n");
    `,
  };

  // A fixture that waits for a child that nothing can reach waits for good. Its test times out, and this ends the fixture.
  const running = new Set<Bun.Subprocess>();
  afterAll(() => {
    for (const proc of running) proc.kill();
  });

  async function run(...args: string[]) {
    using dir = tempDir("child-process-array-prototype", files);
    await using proc = Bun.spawn({
      cmd: [bunExe(), ...args],
      cwd: String(dir),
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });
    running.add(proc);
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    running.delete(proc);
    return { stdout, stderr, exitCode, signalCode: proc.signalCode };
  }
  const ranToItsEnd = { stderr: "", exitCode: 0, signalCode: null };

  const results = {
    "the calls that wait for the child": {
      spawnSync: "intended last\n",
      shell: "in the environment",
      ...(isWindows ? {} : { shellWithArgs: "intended last\n" }),
      execFileSync: "intended last\n",
      nullByte:
        "ERR_INVALID_ARG_VALUE: The argument 'args[1]' must be a string without null bytes. Received 'l\\x00ast'",
      twoIpcSlots: "ERR_IPC_ONE_PIPE",
    },
    "the calls that return a child": {
      execFile: isWindows ? "3 of 4: undefined last\n" : "3 of 4: intended undefined last\n",
      fork: "child got a message",
      spawn: "intended last\n",
      spawnWithFourthPipe: "intended last\n",
      spawnWithAHole: isWindows ? "3 of 4: undefined last\n" : "3 of 4: intended undefined last\n",
      envPairs: "a=b=c",
    },
  };
  const orders = [
    "before node:child_process loads",
    "only while node:child_process loads and is first used",
    "after the first use of node:child_process",
  ];

  describe.each(Object.keys(results) as (keyof typeof results)[])("%s", which => {
    it.concurrent.each(orders)(
      "functions replaced %s: every child gets what was passed, and none of the functions is called",
      async order => {
        expect(await run("replaced-functions.cjs", order, which)).toEqual({
          stdout: JSON.stringify({ result: results[which], calls: {} }) + "\n",
          ...ranToItsEnd,
        });
      },
    );
  });

  // The stdio list is read by index now. map() left a hole where the list has one, and so does the loop.
  it("a hole in the stdio list is no pipe", async () => {
    const stdio: "pipe"[] = [];
    stdio[1] = stdio[2] = "pipe";
    const child = spawn(bunExe(), ["-e", ""], { env: bunEnv, stdio });
    expect([child.stdin, typeof child.stdout, child.stdio.length]).toEqual([null, "object", 3]);
    child.stdout!.resume();
    child.stderr!.resume();
    await once(child, "close");
  });

  // execFile() keeps a copy of the list for the message of a failure. That copy is made by index now.
  it("execFile() names the arguments as they were when it was called", async () => {
    const args = ["-e", "process.exit(3)", "original"];
    const { promise, resolve } = Promise.withResolvers<(Error & { code?: unknown; cmd?: string }) | null>();
    execFile(bunExe(), args, { env: bunEnv }, error => resolve(error));
    args[2] = "changed";
    const error = await promise;
    expect({ code: error?.code, cmd: error?.cmd }).toEqual({ code: 3, cmd: `${bunExe()} -e process.exit(3) original` });
  });

  it.concurrent("spies that a test file restored: the spawns of a later test file work", async () => {
    const { stderr, exitCode } = await run("test", "./a.test.js", "./b.test.js");
    expect(stderr).toContain(" 3 pass\n 0 fail\n");
    expect(exitCode).toBe(0);
  });

  // Node throws a TypeError here. Before, the shell ran the command "undefined" and child.stdio had a hole.
  it.concurrent("a setter on an index of Array.prototype: the commands run (#42723)", async () => {
    expect(await run("index-setter.cjs")).toEqual({
      stdout: "a b c\nthe command ran\nchild.stdio[2] is child.stderr: true\n",
      ...ranToItsEnd,
    });
  });

  // Node reads the array iterator on these paths and throws before it starts a child.
  it.concurrent.each(["3", "4"])(
    "an array iterator that throws, stdio of %s: spawn() and a promisified execFile() read none",
    async stdioLength => {
      const { stdout, ...rest } = await run("throwing-iterator.cjs", stdioLength);
      expect({ lines: stdout.split("\n").filter(Boolean).sort(), ...rest }).toEqual({
        lines: ["spawn() returned", "the child ran", "the child with envPairs ran", "the promised child ran"],
        ...ranToItsEnd,
      });
    },
  );

  it.concurrent(
    "an array iterator that throws while node:child_process first loads: the module loads and spawnSync() reads none",
    async () => {
      expect(await run("throwing-iterator.cjs", "while node:child_process first loads")).toEqual({
        stdout: "the child ran\n",
        ...ranToItsEnd,
      });
    },
  );

  // internal/shared built a Set from a list while it loaded. node:perf_hooks is what uses those names.
  it.concurrent(
    "an array iterator that throws while node:perf_hooks first loads: the module loads, and still knows Node's entry types",
    async () => {
      expect(await run("perf-hooks-under-a-throwing-iterator.cjs")).toEqual({
        stdout: "node:perf_hooks loaded, performance.now is a function\nobserved: function\n",
        ...ranToItsEnd,
      });
    },
  );

  // Without the fix the process waits for a child that nothing can reach, until the test runner stops it.
  it.concurrent.each([
    ["process.nextTick throws", "process.nextTick was called"],
    ["process.nextTick throws, and then kill() throws", "process.nextTick was called"],
    ["the modules of the streams cannot load", "the array iterator was called"],
  ])("spawn() that throws after the child started leaves no child and throws nothing later: %s", async (why, threw) => {
    expect(await run("throws-after-the-child-started.cjs", why)).toEqual({
      stdout: `spawn() threw: ${threw}, after the child started\n`,
      ...ranToItsEnd,
    });
  });

  // As in Node: the copy comes before an option is read.
  it("execFileSync() copies its arguments before a getter of an option can change them", () => {
    const args = ["-e", "process.stdout.write(process.argv.at(-1))", "original"];
    const options = {
      env: bunEnv,
      encoding: "utf8" as const,
      get argv0() {
        args.push("added by a getter");
        return undefined;
      },
    };
    expect(execFileSync(bunExe(), args, options)).toBe("original");
  });

  // As in Node: the list is `[argv0, ...args]`, and its slot 0 names the child and does not choose it.
  it("ChildProcess#spawn() runs options.file, whatever a getter of an option stores in options.args[0]", async () => {
    const spawnargs = [bunExe(), "-e", "process.stdout.write(process.argv.at(-1))", "original"];
    const child = new ChildProcess();
    child.spawn({
      file: bunExe(),
      args: spawnargs,
      envPairs: Object.entries(bunEnv).map(([name, value]) => `${name}=${value}`),
      stdio: ["ignore", "pipe", "inherit"],
      get cwd() {
        spawnargs[0] = "another-program";
        return undefined;
      },
    });
    const closed = once(child, "close");
    expect(await text(child.stdout!)).toBe("original");
    expect(await closed).toEqual([0, null]);
  });

  // parseEnvPairs() reads an array by index. What is not an array keeps its own iterator, as on main.
  it("ChildProcess#spawn() takes envPairs that are not an array as before", async () => {
    const pairs = Object.entries(bunEnv).map(([name, value]) => `${name}=${value}`);
    const child = new ChildProcess();
    child.spawn({
      file: bunExe(),
      args: [bunExe(), "-e", "process.stdout.write(process.env.MARK)"],
      envPairs: new Set([...pairs, "MARK=from a Set"]) as any,
      stdio: ["ignore", "pipe", "inherit"],
    });
    const closed = once(child, "close");
    expect(await text(child.stdout!)).toBe("from a Set");
    expect(await closed).toEqual([0, null]);

    // Not iterable: a TypeError, and no child.
    const arrayLike = { length: 1, 0: "MARK=from an array-like object" } as any;
    expect(() =>
      new ChildProcess().spawn({ file: bunExe(), args: [bunExe()], envPairs: arrayLike, stdio: "ignore" }),
    ).toThrow(TypeError);
  });

  // Main and Node read it three times, whether the child fails or not.
  it("execFileSync() reads options.argv0 as often as before", () => {
    let reads = 0;
    const options = {
      env: bunEnv,
      get argv0() {
        reads++;
        return undefined;
      },
    };
    execFileSync(bunExe(), ["-e", ""], options);
    expect(reads).toBe(3);
  });
});
