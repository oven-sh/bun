import { describe, expect, it } from "bun:test";
import { bunEnv, bunExe, isWindows, tempDir } from "harness";
import { spawn } from "node:child_process";
import { once } from "node:events";

// A child gets the argv, the command line, the stdio and the environment that the caller passed, whatever a script stored on
// Array.prototype. Each case runs in a process of its own.
describe("what a script stored on Array.prototype", () => {
  const files = {
    // Windows has no /bin/echo.
    "echo.cjs": `process.stdout.write(process.argv.slice(2).join(" ") + "\\n");`,
    "ipc-child.cjs": `process.on("message", message => process.send("child got " + message, () => process.disconnect()));`,
    // Prints the same under Node v26.12.1, in each of the three orders.
    "replaced-functions.cjs": /* js */ `
      const order = process.argv[2];
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

      async function useAll(cp) {
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
        let cp;
        if (order === "before node:child_process loads") {
          install();
          cp = require("node:child_process");
        } else if (order === "only while node:child_process loads and is first used") {
          install();
          cp = require("node:child_process");
          await useAll(cp);
          restore();
          watching = true;
        } else if (order === "after the first use of node:child_process") {
          cp = require("node:child_process");
          await useAll(cp);
          install();
        } else throw new Error("unknown order: " + order);
        const result = await useAll(cp);
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
      exec("echo the command ran", (error, stdout) => {
        delete Array.prototype[2];
        process.stdout.write(String(sync.stdout) + (error ? String(error) : stdout));
      });
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
        // The first child loads the modules of the streams.
        cp.execFile(echo, echoed("the first child ran"), { env }, () => {
          Array.prototype[Symbol.iterator] = throwing;
          let promised;
          try {
            cp.spawn(echo, echoed("the child ran"), { env, stdio });
            process.stdout.write("spawn() returned\\n");
            promised = require("node:util").promisify(cp.execFile)(echo, echoed("the promised child ran"), { env });
          } catch (error) {
            process.stdout.write(String(error) + "\\n");
          }
          Array.prototype[Symbol.iterator] = realIterator;
          promised?.then(({ stdout }) => process.stdout.write(stdout));
        });
      }
    `,
    // Prints once its stdin ends, which is when the process that started it is gone.
    "outlives.cjs": `process.stdin.on("end", () => process.stdout.write("the child outlived spawn()\\n")).resume();`,
    "throws-after-the-child-started.cjs": /* js */ `
      const cp = require("node:child_process");
      const env = { ...process.env };
      const stdio = ["pipe", "inherit", "ignore"];
      const realNextTick = process.nextTick;
      // spawn() calls process.nextTick() once the child runs.
      process.nextTick = () => {
        throw new Error("process.nextTick was called");
      };
      let threw = false;
      try {
        // The child holds this process's stdout, and prints there once its stdin ends.
        if (process.platform === "win32") cp.spawn(process.execPath, [__dirname + "\\\\outlives.cjs"], { env, stdio });
        else cp.spawn("/bin/sh", ["-c", "read line; echo 'the child outlived spawn()'"], { env, stdio });
      } catch {
        threw = true;
      }
      process.nextTick = realNextTick;
      process.stdout.write(threw ? "spawn() threw\\n" : "spawn() returned\\n");
    `,
  };

  async function run(...args: string[]) {
    using dir = tempDir("child-process-array-prototype", files);
    await using proc = Bun.spawn({
      cmd: [bunExe(), ...args],
      cwd: String(dir),
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
      // A process that waits for a child that nothing can reach any more would wait for good.
      timeout: 40_000,
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    return { stdout, stderr, exitCode, signalCode: proc.signalCode };
  }
  const ranToItsEnd = { stderr: "", exitCode: 0, signalCode: null };
  // A debug build takes some seconds for each of these: one starts up to 22 children.
  const timeout = 60_000;

  it.concurrent.each([
    "before node:child_process loads",
    "only while node:child_process loads and is first used",
    "after the first use of node:child_process",
  ])(
    "functions replaced %s: every child gets what was passed, and none of the functions is called",
    async order => {
      const result = {
        spawnSync: "intended last\n",
        shell: "in the environment",
        ...(isWindows ? {} : { shellWithArgs: "intended last\n" }),
        execFileSync: "intended last\n",
        nullByte:
          "ERR_INVALID_ARG_VALUE: The argument 'args[1]' must be a string without null bytes. Received 'l\\x00ast'",
        twoIpcSlots: "ERR_IPC_ONE_PIPE",
        execFile: isWindows ? "3 of 4: undefined last\n" : "3 of 4: intended undefined last\n",
        fork: "child got a message",
        spawn: "intended last\n",
        spawnWithFourthPipe: "intended last\n",
        spawnWithAHole: isWindows ? "3 of 4: undefined last\n" : "3 of 4: intended undefined last\n",
        envPairs: "a=b=c",
      };
      expect(await run("replaced-functions.cjs", order)).toEqual({
        stdout: JSON.stringify({ result, calls: {} }) + "\n",
        ...ranToItsEnd,
      });
    },
    timeout,
  );

  // The stdio list is read by index now. map() left a hole where the list has one, and so does the loop.
  it("a hole in the stdio list is no pipe", async () => {
    const child = spawn(bunExe(), ["-e", ""], { env: bunEnv, stdio: [, "pipe", "pipe"] });
    expect([child.stdin, typeof child.stdout, child.stdio.length]).toEqual([null, "object", 3]);
    child.stdout!.resume();
    child.stderr!.resume();
    await once(child, "close");
  });

  it.concurrent(
    "spies that a test file restored: the spawns of a later test file work",
    async () => {
      const { stderr, exitCode } = await run("test", "./a.test.js", "./b.test.js");
      expect(stderr).toContain(" 3 pass\n 0 fail\n");
      expect(exitCode).toBe(0);
    },
    timeout,
  );

  // Node throws a TypeError here. Before, the shell ran the command "undefined".
  it.concurrent(
    "a setter on an index of Array.prototype: the commands run (#42723)",
    async () => {
      expect(await run("index-setter.cjs")).toEqual({ stdout: "a b c\nthe command ran\n", ...ranToItsEnd });
    },
    timeout,
  );

  // Node reads the array iterator on these paths and throws before it starts a child.
  it.concurrent.each(["3", "4"])(
    "an array iterator that throws, stdio of %s: spawn() and a promisified execFile() read none",
    async stdioLength => {
      const { stdout, ...rest } = await run("throwing-iterator.cjs", stdioLength);
      expect({ lines: stdout.split("\n").filter(Boolean).sort(), ...rest }).toEqual({
        lines: ["spawn() returned", "the child ran", "the promised child ran"],
        ...ranToItsEnd,
      });
    },
    timeout,
  );

  it.concurrent(
    "an array iterator that throws while node:child_process first loads: the module loads and spawnSync() reads none",
    async () => {
      expect(await run("throwing-iterator.cjs", "while node:child_process first loads")).toEqual({
        stdout: "the child ran\n",
        ...ranToItsEnd,
      });
    },
    timeout,
  );

  it.concurrent(
    "spawn() that throws after the child started leaves no child behind",
    async () => {
      expect(await run("throws-after-the-child-started.cjs")).toEqual({ stdout: "spawn() threw\n", ...ranToItsEnd });
    },
    timeout,
  );
});
