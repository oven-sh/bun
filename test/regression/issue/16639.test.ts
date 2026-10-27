import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { bunEnv, bunExe, isASAN, isDebug, isWindows, tempDir } from "harness";
import { join } from "node:path";

// https://github.com/oven-sh/bun/issues/16639
//
// url.parse() prints DEP0169 unless the file of its caller is under node_modules. Without
// --sourcemap every frame of a standalone executable has the name of the executable. With
// --sourcemap the names are relative to the build directory ("node_modules/dep/index.js"),
// and the check needs a separator before "node_modules". In both builds the call of a bundled
// dependency printed the warning (axios before 1.14.0, engine.io before 6.6.5, parseurl 1.3.3).

// url.parse() and the four other node:url entry points that go through the same check.
const urlCalls = /* js */ `
  const url = require("node:url");
  module.exports = {
    "url.parse": () => url.parse("http://example.com/a"),
    "url.format": () => url.format("http://example.com/a"),
    "url.resolve": () => url.resolve("http://example.com/a", "b"),
    "url.resolveObject": () => url.resolveObject("http://example.com/a", "b"),
    "Url.prototype.resolve": () => {
      const parsed = new url.Url();
      parsed.parse("http://example.com/a");
      return parsed.resolve("b");
    },
  };
`;

const files = {
  "package.json": JSON.stringify({ name: "app", version: "1.0.0" }),
  "node_modules/dep/package.json": JSON.stringify({ name: "dep", version: "1.0.0", main: "index.js" }),
  "node_modules/dep/index.js": urlCalls,
  "own.js": urlCalls,
  // Each argument is one step: "dep" and "own" make every call from that file,
  // "worker" makes the calls of "dep" in a Worker, "emit" emits another deprecation.
  "app.js": /* js */ `
    const { Worker } = require("node:worker_threads");
    const callers = { dep: require("dep"), own: require("./own.js") };
    (async () => {
      for (const step of process.argv.slice(2)) {
        if (step === "emit") {
          process.emitWarning("still printed", "DeprecationWarning", "DEP9999");
        } else if (step === "worker") {
          await new Promise((resolve, reject) => {
            const worker = new Worker("./worker.js");
            worker.on("message", resolve);
            worker.on("error", reject);
          });
        } else {
          for (const name in callers[step]) callers[step][name]();
        }
      }
      console.log("done");
    })();
  `,
  "worker.js": /* js */ `
    const { parentPort } = require("node:worker_threads");
    const dep = require("dep");
    for (const name in dep) dep[name]();
    parentPort.postMessage("done");
  `,
};

// A standalone executable of a debug or ASAN build is over 1 GB. It is slow to write and to start.
const timeout = isDebug || isASAN ? 60_000 : undefined;

describe("url.parse() deprecation warning (DEP0169)", () => {
  let dir: ReturnType<typeof tempDir>;
  let exe: string;
  let exeWithSourcemap: string;

  async function run(cmd: string[], env: Record<string, string> = {}) {
    await using proc = Bun.spawn({
      cmd,
      env: { ...bunEnv, ...env },
      cwd: String(dir),
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    return { stdout, stderr, exitCode };
  }

  const countOfDEP0169 = (stderr: string) => stderr.split("[DEP0169]").length - 1;
  const quiet = { stdout: "done\n", stderr: "", exitCode: 0 };

  async function compile(name: string, flags: string[]) {
    const outfile = join(String(dir), isWindows ? `${name}.exe` : name);
    const cmd = [bunExe(), "build", "--compile", ...flags, "./app.js", "./worker.js", "--outfile", outfile];
    const build = await run(cmd);
    if (build.exitCode !== 0) throw new Error(`bun build --compile failed:\n${build.stderr}`);
    return outfile;
  }

  beforeAll(async () => {
    dir = tempDir("issue-16639", files);
    // One at a time: two writes of a debug executable at once take longer than one after the other.
    exe = await compile("app", []);
    exeWithSourcemap = await compile("app-sourcemap", ["--sourcemap"]);
  }, 180_000);

  afterAll(() => dir?.[Symbol.dispose]());

  describe("in a standalone executable", () => {
    test.concurrent(
      "the calls of a dependency print nothing",
      async () => {
        expect(await run([exe, "dep"])).toEqual(quiet);
      },
      timeout,
    );

    test.concurrent(
      "the calls of the program print nothing",
      async () => {
        expect(await run([exe, "own"])).toEqual(quiet);
      },
      timeout,
    );

    test.concurrent(
      "the calls of a dependency in a Worker print nothing",
      async () => {
        expect(await run([exe, "worker"])).toEqual(quiet);
      },
      timeout,
    );

    // The frames have the names of their sources here: "node_modules/dep/index.js" and "own.js".
    test.concurrent(
      "the calls print nothing when the executable has a sourcemap",
      async () => {
        expect(await run([exeWithSourcemap, "dep", "own"])).toEqual(quiet);
      },
      timeout,
    );

    test.concurrent(
      "the calls print nothing and do not throw with --throw-deprecation",
      async () => {
        const options = "--throw-deprecation --trace-deprecation --pending-deprecation";
        expect(await run([exe, "dep", "own"], { BUN_OPTIONS: options })).toEqual(quiet);
      },
      timeout,
    );

    test.concurrent(
      "other deprecation warnings are still printed",
      async () => {
        const { stdout, stderr, exitCode } = await run([exe, "dep", "emit"]);
        expect(stderr).toContain("[DEP9999] DeprecationWarning: still printed");
        expect({ stdout, DEP0169: countOfDEP0169(stderr), exitCode }).toEqual({
          stdout: "done\n",
          DEP0169: 0,
          exitCode: 0,
        });
      },
      timeout,
    );

    // BUN_BE_BUN=1 makes the executable the bun CLI: it reads app.js from the disk.
    test.concurrent(
      "the executable as the bun CLI prints the warning",
      async () => {
        const { stdout, stderr, exitCode } = await run([exe, "app.js", "dep", "own", "own"], { BUN_BE_BUN: "1" });
        expect({ stdout, DEP0169: countOfDEP0169(stderr), exitCode }).toEqual({
          stdout: "done\n",
          DEP0169: 1,
          exitCode: 0,
        });
      },
      timeout,
    );
  });

  describe("with bun run", () => {
    test.concurrent(
      "the calls of a dependency print nothing",
      async () => {
        expect(await run([bunExe(), "app.js", "dep"])).toEqual(quiet);
      },
      timeout,
    );

    test.concurrent(
      "the calls of the program print the warning one time",
      async () => {
        const { stdout, stderr, exitCode } = await run([bunExe(), "app.js", "dep", "own", "own"]);
        expect({ stdout, DEP0169: countOfDEP0169(stderr), exitCode }).toEqual({
          stdout: "done\n",
          DEP0169: 1,
          exitCode: 0,
        });
      },
      timeout,
    );
  });
});
