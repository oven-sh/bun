import { spawn } from "bun";
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import fs from "fs/promises";
import { bunEnv, bunExe, isDebug, tempDir } from "harness";
import os from "os";
import path from "path";
import { parseArgs } from "util";

describe("parseArgs default args", () => {
  let temp_dir;

  beforeAll(async () => {
    temp_dir = await fs.realpath(
      await fs.mkdtemp(path.join(os.tmpdir(), "bun-run.test." + Math.trunc(Math.random() * 9999999).toString(32))),
    );
    await fs.writeFile(
      path.join(temp_dir, "package.json"),
      `{
                "scripts": {
                    "script-test": "file-test.js"
                }
            }`,
    );
    await fs.writeFile(
      path.join(temp_dir, "file-test.js"),
      `console.log(JSON.stringify({ argv: process.argv, execArgv: process.execArgv, ...require("node:util").parseArgs({ strict: false }) }));`,
    );
  });
  afterAll(async () => {
    await fs.rm(temp_dir, { force: true, recursive: true });
  });

  async function spawnBun(...args) {
    const subprocess = spawn({
      cmd: [bunExe(), ...args],
      cwd: temp_dir,
      stdout: "pipe",
      stderr: "pipe",
      stdin: "pipe",
      env: {
        ...bunEnv,
      },
    });
    subprocess.stdin.end();
    let exited = false;
    let timer = setTimeout(() => {
      if (!exited) {
        subprocess.kill();
      }
    }, 5000);
    const exitCode = await subprocess.exited;
    exited = true;
    clearTimeout(timer);
    const stdout = await subprocess.stdout.text();
    expect(exitCode).toBe(0);
    return { stdout };
  }

  test.each([
    ["file-test.js --foo asdf", ["foo"], ["asdf"], []], // implicit run
    ["run file-test.js --foo asdf", ["foo"], ["asdf"], []], // explicit run
    ["--bun file-test.js --foo asdf", ["foo"], ["asdf"], ["--bun"]], // implicit run, with bun "--bun" arg (should not appear in argv)
    ["run --bun file-test.js --foo asdf", ["foo"], ["asdf"], ["--bun"]], // explicit run, with bun "--bun" arg (after the run)
    ["--bun run file-test.js --foo asdf", ["foo"], ["asdf"], ["--bun"]], // explicit run, with bun "--bun" arg (before the run)
    ["--bun run --env-file='' file-test.js --foo asdf", ["foo"], ["asdf"], ["--bun", "--env-file=''"]], // explicit run, multiple bun args
    ["run file-test.js --bun", ["bun"], [], []], // passing --bun only to the program
    ["--bun run file-test.js --foo asdf -- --foo2 -- --foo3", ["foo"], ["asdf", "--foo2", "--", "--foo3"], ["--bun"]],
    ["--bun -e require('./file-test.js') -- --foo asdf", ["foo"], ["asdf"], undefined],
    ["--bun --eval require('./file-test.js') -- --foo asdf", ["foo"], ["asdf"], undefined],
    ["--eval require('./file-test.js') -- --foo asdf -- --bar", ["foo"], ["asdf", "--bar"], undefined],
    ["--eval=require('./file-test.js') -- --foo asdf -- --bar", ["foo"], ["asdf", "--bar"], undefined],
  ])('running "bun %s"', async (argline, valuesKeys, positionals, execArgv) => {
    const result = await spawnBun(...argline.split(/\s+/));
    let output;
    expect(() => (output = JSON.parse(result.stdout))).not.toThrow();
    expect(Object.keys(output?.values ?? {}).sort()).toEqual(valuesKeys.sort());
    expect(output?.positionals).toEqual(positionals);
    if (execArgv) {
      expect(output?.execArgv).toEqual(execArgv);
    }
  });
});

// The calls each launch below makes. `programArgs` holds what Node v26.3.0 returns from them for
// each set of program arguments. An error is reported as its code.
//
// `ifStrictReturns` is for a launch with no program arguments. There, a throw from the strict call
// means parseArgs read past the end of process.argv, and a call that accepts positionals would
// not return.
const calls = ({ ifStrictReturns = false } = {}) =>
  "(() => { const { parseArgs } = require('node:util');" +
  " const call = config => { try { return parseArgs(config); } catch (error) { return error.code; } };" +
  " const strict = call();" +
  (ifStrictReturns ? " if (typeof strict === 'string') return JSON.stringify([strict]);" : "") +
  " return JSON.stringify([strict, call({ strict: false }), call({ strict: false, tokens: true })]); })()";
const programArgs = [
  {
    args: [],
    results: [
      { values: {}, positionals: [] },
      { values: {}, positionals: [] },
      { values: {}, positionals: [], tokens: [] },
    ],
  },
  {
    args: ["zzz", "yyy"],
    results: [
      "ERR_PARSE_ARGS_UNEXPECTED_POSITIONAL",
      { values: {}, positionals: ["zzz", "yyy"] },
      {
        values: {},
        positionals: ["zzz", "yyy"],
        tokens: [
          { kind: "positional", index: 0, value: "zzz" },
          { kind: "positional", index: 1, value: "yyy" },
        ],
      },
    ],
  },
  {
    args: ["--", "--foo", "bar"],
    results: [
      "ERR_PARSE_ARGS_UNKNOWN_OPTION",
      { values: { foo: true }, positionals: ["bar"] },
      {
        values: { foo: true },
        positionals: ["bar"],
        tokens: [
          { kind: "option", name: "foo", rawName: "--foo", index: 0 },
          { kind: "positional", index: 1, value: "bar" },
        ],
      },
    ],
  },
];
const [noArgs, twoArgs] = programArgs;

async function run(cmd, options) {
  await using proc = Bun.spawn({
    cmd: [bunExe(), ...cmd],
    env: bunEnv,
    stdin: "ignore",
    stdout: "pipe",
    stderr: "pipe",
    ...options,
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  return { stdout: stdout.trim(), stderr, signalCode: proc.signalCode, exitCode };
}
const printed = stdout => ({ stdout, stderr: "", signalCode: null, exitCode: 0 });

describe.concurrent("parseArgs default args when eval code is the program", () => {
  // Node has no `-e=`, `-p=` or `--print=`. They get what the other spellings get.
  const spellings = [
    ["-e <code>", code => ["-e", `process.stdout.write(${code})`]],
    ["--eval <code>", code => ["--eval", `process.stdout.write(${code})`]],
    ["--eval=<code>", code => [`--eval=process.stdout.write(${code})`]],
    ["-e=<code>", code => [`-e=process.stdout.write(${code})`]],
    ["-p <code>", code => ["-p", code]],
    ["--print <code>", code => ["--print", code]],
    ["--print=<code>", code => [`--print=${code}`]],
    ["-p=<code>", code => [`-p=${code}`]],
    ["-pe <code>", code => ["-pe", code]],
  ];
  const launches = spellings.flatMap(([spelling, flags]) =>
    programArgs.map(({ args, results }) => [
      [spelling, ...args].join(" "),
      [...flags(calls({ ifStrictReturns: args.length === 0 })), ...args],
      results,
    ]),
  );

  test.each(launches)("bun %s", async (_, cmd, results) => {
    using dir = tempDir("parse-args-eval", {});
    expect(await run(cmd, { cwd: String(dir) })).toEqual(printed(JSON.stringify(results)));
  });

  test("bun as node --eval=<code>", async () => {
    using dir = tempDir("parse-args-as-node", {});
    const cmd = ["--bun", "node", `--eval=process.stdout.write(${calls({ ifStrictReturns: true })})`];
    expect(await run(cmd, { cwd: String(dir) })).toEqual(printed(JSON.stringify(noArgs.results)));
  });
});

describe.concurrent("parseArgs default args when process.argv has a script entry", () => {
  const program = `process.stdout.write(${calls()})`;

  test("bun - zzz yyy", async () => {
    using dir = tempDir("parse-args-stdin", {});
    const options = { cwd: String(dir), stdin: Buffer.from(program) };
    expect(await run(["-", ...twoArgs.args], options)).toEqual(printed(JSON.stringify(twoArgs.results)));
  });

  // `bun run` runs the file and not the eval code.
  test("bun run -e <code> ./program.cjs zzz yyy", async () => {
    using dir = tempDir("parse-args-run-eval", { "program.cjs": program });
    const cmd = ["run", "-e", "0", "./program.cjs", ...twoArgs.args];
    expect(await run(cmd, { cwd: String(dir) })).toEqual(printed(JSON.stringify(twoArgs.results)));
  });
});

describe.concurrent("parseArgs default args when process.argv is short", () => {
  test("bun repl", async () => {
    using dir = tempDir("parse-args-repl", {});
    const { stdout, ...rest } = await run(["repl"], {
      cwd: String(dir),
      stdin: Buffer.from(`console.log(${calls({ ifStrictReturns: true })})\n`),
      env: { ...bunEnv, TERM: "dumb", NO_COLOR: "1", HOME: String(dir), USERPROFILE: String(dir) },
    });
    const lines = Bun.stripANSI(stdout)
      .split("\n")
      .filter(line => line.startsWith("["));
    expect({ lines, ...rest }).toEqual({
      lines: [JSON.stringify(noArgs.results)],
      stderr: "",
      signalCode: null,
      exitCode: 0,
    });
  });

  test("a script that shortens process.argv", async () => {
    using dir = tempDir("parse-args-short-argv", {
      "short-argv.cjs": `
        const results = [];
        const shorten = [() => [], () => ["only-one"], argv => ((argv.length = 1), argv), argv => ((argv.length = 0), argv)];
        for (const fn of shorten) {
          process.argv = fn(["exe", "script", "zzz"]);
          results.push(JSON.parse(${calls({ ifStrictReturns: true })}));
        }
        process.stdout.write(JSON.stringify(results));
      `,
    });
    const expected = JSON.stringify([noArgs.results, noArgs.results, noArgs.results, noArgs.results]);
    expect(await run(["short-argv.cjs"], { cwd: String(dir) })).toEqual(printed(expected));
  });
});

// Node keeps `--eval` per thread: a Worker has the value of the thread that made it, or the one
// in its own `execArgv`. Every expected value is what Node v26.3.0 returns in a `worker_threads`
// Worker with the same `argv` and `execArgv`.
describe.concurrent("parseArgs default args in a Worker", () => {
  const files = {
    "worker.cjs": `
      const { positionals } = require("node:util").parseArgs({ strict: false });
      postMessage(positionals.map(arg => arg.split(/[\\\\/]/).pop()));
    `,
  };
  // Prints what parseArgs returns in a Worker that is given `options`.
  const startWorker = options =>
    `const worker = new Worker('./worker.cjs', { argv: ['zzz', 'yyy'], ...${JSON.stringify(options)} });` +
    " worker.onmessage = event => console.log(JSON.stringify(event.data));" +
    " worker.onerror = event => { console.error(event.message); process.exitCode = 1; };";
  const slicedAt1 = JSON.stringify(["worker.cjs", "zzz", "yyy"]);
  const slicedAt2 = JSON.stringify(["zzz", "yyy"]);

  test.each(
    [
      [undefined, slicedAt2],
      [[], slicedAt2],
      [["--eval", "1"], slicedAt1],
      [["--eval=1"], slicedAt1],
      [["-e", "1"], slicedAt1],
      [["-pe", "1"], slicedAt1],
      [["-p", "1"], slicedAt1],
      [["-p"], slicedAt2],
      [["--eval", ""], slicedAt2],
      [["--eval", "1", "--eval", ""], slicedAt2],
    ].map(([execArgv, stdout]) => [
      execArgv ? `execArgv ${JSON.stringify(execArgv)}` : "no execArgv",
      execArgv,
      stdout,
    ]),
  )("with a file as the program and %s", async (_, execArgv, stdout) => {
    using dir = tempDir("parse-args-worker", { ...files, "parent.cjs": startWorker({ execArgv }) });
    expect(await run(["parent.cjs"], { cwd: String(dir) })).toEqual(printed(stdout));
  });

  test.each([
    ["-e <code>", ["-e", startWorker({})], slicedAt1],
    ["--eval=<code>", [`--eval=${startWorker({})}`], slicedAt1],
    ["--eval=<code> and execArgv []", [`--eval=${startWorker({ execArgv: [] })}`], slicedAt2],
    ["-pe <code>", ["-pe", `${startWorker({})} void 0`], `${slicedAt1}\nundefined`],
  ])("with bun %s as the program", async (_, cmd, stdout) => {
    using dir = tempDir("parse-args-worker", files);
    expect(await run(cmd, { cwd: String(dir) })).toEqual(printed(stdout));
  });
});

// Node's tokenizer reads `ArrayPrototypeSlice(args)`, so nothing that runs during the parse can
// change what it reads. Every expected value is what Node v26.3.0 returns, except where a test
// says otherwise.
describe("parseArgs reads a copy of the arguments", () => {
  const result = (positionals, values = {}) => ({ values: { __proto__: null, ...values }, positionals });

  test("explicit args are copied after the config getters run", () => {
    const shrunk = ["p1", "p2", "p3"];
    // prettier-ignore
    expect(parseArgs({ args: shrunk, get strict() { shrunk.length = 0; return false; } })).toEqual(result([]));

    const grown = [];
    // prettier-ignore
    expect(parseArgs({ args: grown, get strict() { grown.push("late"); return false; } })).toEqual(result(["late"]));

    const shrunkByOption = ["--foo", "p2"];
    // prettier-ignore
    const options = { foo: { get type() { shrunkByOption.length = 0; return "boolean"; } } };
    expect(parseArgs({ args: shrunkByOption, strict: false, options })).toEqual(result([]));
  });

  test("default args are copied before the config getters run", () => {
    const { argv } = process;
    try {
      process.argv = ["exe", "script", "p1", "p2"];
      // prettier-ignore
      expect(parseArgs({ get strict() { process.argv.length = 2; return false; } })).toEqual(result(["p1", "p2"]));

      process.argv = ["exe", "script"];
      // prettier-ignore
      expect(parseArgs({ get strict() { process.argv.push("late"); return false; } })).toEqual(result([]));

      process.argv = ["exe", "script", "p1"];
      // prettier-ignore
      expect(parseArgs({ get strict() { process.argv = ["exe", "script", "other"]; return false; } })).toEqual(result(["p1"]));
    } finally {
      process.argv = argv;
    }
  });

  test("an argument's toString cannot change the arguments after it", () => {
    // prettier-ignore
    const shrunk = [{ toString() { shrunk.length = 1; return "x"; } }, "p2", "p3"];
    expect(parseArgs({ args: shrunk, strict: false })).toEqual(result([shrunk[0], "p2", "p3"]));

    // prettier-ignore
    const grown = [{ toString() { grown.push("late"); return "x"; } }, "p2"];
    expect(parseArgs({ args: grown, strict: false })).toEqual(result([grown[0], "p2"]));

    // prettier-ignore
    const replaced = [{ toString() { replaced[1] = "--changed"; return "x"; } }, "p2"];
    expect(parseArgs({ args: replaced, strict: false })).toEqual(result([replaced[0], "p2"]));
  });

  test("process.execArgv does not choose where the default args start", () => {
    const { argv, execArgv } = process;
    try {
      process.argv = [process.argv0, "script.js", "--foo"];
      for (const fake of [["-e", "0"], ["--eval", "0"], ["-p", "0"], ["--print", "0"], undefined]) {
        process.execArgv = fake;
        expect(parseArgs({ strict: false })).toEqual(result([], { foo: true }));
      }
    } finally {
      process.argv = argv;
      process.execArgv = execArgv;
    }
  });

  // Node has no limit: it copies all 2^32 - 1 holes first, which does not return in 8 seconds.
  // Each strict call goes first: if the limit is gone, only a strict call returns.
  describe("an array that is not plain storage", () => {
    const tooLong = received => ({
      name: "RangeError",
      code: "ERR_OUT_OF_RANGE",
      message: `The value of "args.length" is out of range. It must be <= 1048576. Received ${received}`,
    });
    const thrown = fn => {
      try {
        fn();
      } catch (error) {
        return { name: error.name, code: error.code, message: error.message };
      }
    };

    test("is rejected before it is copied when it is longer than the limit", () => {
      for (const length of [2 ** 32 - 1, 2 ** 20 + 1]) {
        const args = new Array(length);
        expect(thrown(() => parseArgs({ args }))).toEqual(tooLong(length));
        expect(thrown(() => parseArgs({ args, strict: false }))).toEqual(tooLong(length));
      }
    });

    test("is rejected as default args too", () => {
      const { argv } = process;
      try {
        process.argv = [];
        process.argv.length = 2 ** 32 - 1;
        expect(thrown(() => parseArgs())).toEqual(tooLong(2 ** 32 - 3));
        expect(thrown(() => parseArgs({ strict: false }))).toEqual(tooLong(2 ** 32 - 3));
      } finally {
        process.argv = argv;
      }
    });

    // A debug build takes 4 seconds to read 2^20 elements.
    test.skipIf(isDebug)("is copied when it is as long as the limit", () => {
      expect(thrown(() => parseArgs({ args: new Array(2 ** 20) }))?.code).toBe("ERR_PARSE_ARGS_UNEXPECTED_POSITIONAL");
    });
  });

  // A debug build takes 1.4 seconds to build and copy this array.
  test.skipIf(isDebug)("a plain array has no length limit", () => {
    const args = [];
    for (let i = 0; i <= 2 ** 20; i++) args.push("--nope");
    expect(() => parseArgs({ args })).toThrow(expect.objectContaining({ code: "ERR_PARSE_ARGS_UNKNOWN_OPTION" }));
  });
});
