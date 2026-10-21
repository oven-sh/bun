import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, isDebug, tempDir } from "harness";
import { join } from "node:path";
import { parseArgs } from "node:util";

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
const programArgs: { args: string[]; results: unknown[] }[] = [
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

// Serial on purpose: twenty bun processes at once put slow builds close to the test timeout.
async function run(cmd: string[], options: { cwd: string; stdin?: Buffer; env?: Record<string, string | undefined> }) {
  await using proc = Bun.spawn({
    cmd: [bunExe(), ...cmd],
    env: bunEnv,
    stdin: "ignore",
    ...options,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  return { stdout: stdout.trim(), stderr, signalCode: proc.signalCode, exitCode };
}
const printed = (stdout: string) => ({ stdout, stderr: "", signalCode: null, exitCode: 0 });

describe("parseArgs default args when eval code is the program", () => {
  // `-e=<code>`, `-p=<code>` and `--print=<code>` are bun's spellings. They get what the other spellings get.
  const spellings: [name: string, flags: (code: string) => string[]][] = [
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
    programArgs.map(({ args, results }): [name: string, cmd: string[], results: unknown[]] => [
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

// A file is the program. `process.execArgv` has bun's own flags, and the result does not.
describe("parseArgs default args when a file is the program", () => {
  const files = {
    "package.json": JSON.stringify({ scripts: { "script-test": "file-test.js" } }),
    "file-test.js": `
      const { values, positionals } = require("node:util").parseArgs({ strict: false });
      console.log(JSON.stringify({ names: Object.keys(values).sort(), positionals, execArgv: process.execArgv }));
    `,
  };
  const launches: [cmd: string, names: string[], positionals: string[], execArgv: string[]][] = [
    ["file-test.js --foo asdf", ["foo"], ["asdf"], []],
    ["run file-test.js --foo asdf", ["foo"], ["asdf"], []],
    ["--bun file-test.js --foo asdf", ["foo"], ["asdf"], ["--bun"]],
    ["run --bun file-test.js --foo asdf", ["foo"], ["asdf"], ["--bun"]],
    ["--bun run file-test.js --foo asdf", ["foo"], ["asdf"], ["--bun"]],
    ["--bun run --env-file='' file-test.js --foo asdf", ["foo"], ["asdf"], ["--bun", "--env-file=''"]],
    ["run file-test.js --bun", ["bun"], [], []],
    ["--bun run file-test.js --foo asdf -- --foo2 -- --foo3", ["foo"], ["asdf", "--foo2", "--", "--foo3"], ["--bun"]],
  ];

  test.each(launches)("bun %s", async (cmd, names, positionals, execArgv) => {
    using dir = tempDir("parse-args-file", files);
    const expected = JSON.stringify({ names, positionals, execArgv });
    expect(await run(cmd.split(" "), { cwd: String(dir) })).toEqual(printed(expected));
  });
});

describe("parseArgs default args when process.argv has a script entry", () => {
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

describe("parseArgs default args when process.argv is short", () => {
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

  test("bun -e <code that empties process.argv>", async () => {
    using dir = tempDir("parse-args-empty-argv", {});
    const code = `process.argv.length = 0; process.stdout.write(${calls({ ifStrictReturns: true })})`;
    expect(await run(["-e", code], { cwd: String(dir) })).toEqual(printed(JSON.stringify(noArgs.results)));
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

// `--eval` has a value in Node's REPL only when the `-e` code is not empty. Every expected value is
// what Node v26.3.0 prints for `node -i` with the same flags. Not in a debug build: node:repl takes
// 4 seconds to start there, and the limit of a test is 5.
describe.skipIf(isDebug)("parseArgs default args under --interactive", () => {
  const input =
    'process.argv = ["a", "b", "c"];' +
    ' console.log("R=" + JSON.stringify(require("node:util").parseArgs({ strict: false }).positionals))\n';
  const launches: [name: string, flags: string[], positionals: string[]][] = [
    ["--interactive -e 1", ["-e", "1"], ["b", "c"]],
    ["--interactive -e ''", ["-e", ""], ["c"]],
  ];

  test.each(launches)("bun %s", async (_, flags, positionals) => {
    using dir = tempDir("parse-args-interactive", {});
    const env = { ...bunEnv, NO_COLOR: "1", NODE_REPL_HISTORY: "" };
    const options = { cwd: String(dir), stdin: Buffer.from(input), env };
    const { stdout, ...rest } = await run(["--interactive", ...flags], options);
    const lines = stdout
      .split("\n")
      .filter(line => line.includes("R="))
      .map(line => line.slice(line.indexOf("R=")));
    expect({ lines, ...rest }).toEqual({
      lines: [`R=${JSON.stringify(positionals)}`],
      stderr: "",
      signalCode: null,
      exitCode: 0,
    });
  });
});

// Node keeps `--eval` per thread: a Worker has the value of the thread that made it, or the one
// in its own `execArgv`. Every expected value is what Node v26.3.0 returns in a `worker_threads`
// Worker with the same `argv` and `execArgv`, but for the rows that Node rejects.
describe("parseArgs default args in a Worker", () => {
  const files = {
    "worker.cjs": `
      const { positionals } = require("node:util").parseArgs({ strict: false });
      postMessage(positionals.map(arg => arg.split(/[\\\\/]/).pop()));
    `,
    // A Worker that makes the Worker above and passes its answer on.
    "relay.cjs": `
      const worker = new Worker("./worker.cjs", { argv: ["zzz", "yyy"] });
      worker.onmessage = event => postMessage(event.data);
    `,
    "preload.cjs": "",
  };
  const slicedAt1 = ["worker.cjs", "zzz", "yyy"];
  const slicedAt2 = ["zzz", "yyy"];
  const ownExecArgv: [execArgv: string[], positionals: string[]][] = [
    [[], slicedAt2],
    [["--eval", "1"], slicedAt1],
    [["--eval=1"], slicedAt1],
    [["-e", "1"], slicedAt1],
    [["-pe", "1"], slicedAt1],
    [["-p", "1"], slicedAt1],
    [["--print", "1"], slicedAt1],
    [["-p"], slicedAt2],
    [["--eval", ""], slicedAt2],
    [["-e", "\u0000"], slicedAt1],
    // A print flag only prints before an empty token, `-`, `--` or an option, and `--print=<x>` is `--print`.
    [["-p", ""], slicedAt2],
    [["-p", "-"], slicedAt2],
    [["-p", "--"], slicedAt2],
    [["-p", "--no-addons"], slicedAt2],
    [["-p", "--conditions=x"], slicedAt2],
    [["-p", "-r", "node:path"], slicedAt2],
    [["-p", "-pe", ""], slicedAt2],
    [["-p", "1", "-e", ""], slicedAt2],
    [["--eval=1", "-p", ""], slicedAt1],
    [["--print=1"], slicedAt2],
    [["--print=1", "x"], slicedAt1],
    [["-e", "1", "--print="], slicedAt1],
    // A token after a flag that takes a value is that value. The last eval flag wins.
    [["-r", "node:path", "-e", "1"], slicedAt1],
    [["--unhandled-rejections", "strict", "-e", "1"], slicedAt1],
    [["-C", "x", "-e", "1"], slicedAt1],
    [["--conditions=\u2603", "-e", "1"], slicedAt1],
    [["--enable-source-maps", "-e", "1", "x", "-e", ""], slicedAt1],
    [["-e", "", "-e", "1"], slicedAt1],
    [["-e", "1", "-e", ""], slicedAt2],
    // The flags end at a token that is not a flag and not a value, and at `--`.
    [["x", "-e", "1"], slicedAt2],
    [["script.js", "-e", "1"], slicedAt2],
    [["\u2603.js", "-e", "1"], slicedAt2],
    [["-", "-e", "1"], slicedAt2],
    [["--no-addons", "x", "-e", "1"], slicedAt2],
    [["-c", "x", "-e", "1"], slicedAt2],
    [["--conditions=x", "x", "-e", "1"], slicedAt2],
    [["-r", "node:path", "x", "-e", "1"], slicedAt2],
    [["--", "-e", "1"], slicedAt2],
    // Node rejects the next six. They are read as bun's CLI reads them.
    [["-e=1"], slicedAt1],
    [["-p=1"], slicedAt1],
    [["-e", "1", "--eval="], slicedAt2],
    [["-e", "-1"], slicedAt1],
    [["-p", "-1"], slicedAt1],
    [["-e", "1", "-e"], slicedAt2],
  ];

  // The Worker's own `execArgv` decides, so the program can be this test.
  test.each(
    ownExecArgv.map(([execArgv, positionals]): [name: string, execArgv: string[], positionals: string[]] => [
      JSON.stringify(execArgv),
      execArgv,
      positionals,
    ]),
  )("with execArgv %s", async (_, execArgv, positionals) => {
    using dir = tempDir("parse-args-worker", files);
    const options = { argv: ["zzz", "yyy"], execArgv } as Bun.WorkerOptions;
    const worker = new Worker(join(String(dir), "worker.cjs"), options);
    try {
      const { promise, resolve, reject } = Promise.withResolvers<string[]>();
      worker.onmessage = event => resolve(event.data);
      worker.onerror = event => reject(new Error(event.message));
      expect(await promise).toEqual(positionals);
    } finally {
      worker.terminate();
    }
  });

  // Prints what parseArgs returns in a Worker that is given `options`.
  const startWorker = (options: { execArgv?: string[] }, more = "", file = "./worker.cjs") =>
    `const worker = new Worker('${file}', { argv: ['zzz', 'yyy'], ...${JSON.stringify(options)}${more} });` +
    " worker.onmessage = event => console.log(JSON.stringify(event.data));" +
    " worker.onerror = event => { console.error(event.message); process.exitCode = 1; };";
  const [printsAt1, printsAt2] = [JSON.stringify(slicedAt1), JSON.stringify(slicedAt2)];
  const programs: [name: string, cmd: string[], stdout: string][] = [
    ["<file>", ["parent.cjs"], printsAt2],
    ["-e <code>", ["-e", startWorker({})], printsAt1],
    ["--eval=<code>", [`--eval=${startWorker({})}`], printsAt1],
    ["--eval=<code> and execArgv []", [`--eval=${startWorker({ execArgv: [] })}`], printsAt2],
    ["-pe <code>", ["-pe", `${startWorker({})} void 0`], `${printsAt1}\nundefined`],
    [
      "-r <file> -e <code> and execArgv: process.execArgv",
      ["-r", "./preload.cjs", "-e", startWorker({}, ", execArgv: process.execArgv")],
      printsAt1,
    ],
  ];
  test.each(programs)("with bun %s as the program", async (_, cmd, stdout) => {
    using dir = tempDir("parse-args-worker", { ...files, "parent.cjs": startWorker({}) });
    expect(await run(cmd, { cwd: String(dir) })).toEqual(printed(stdout));
  });

  // A Worker without `execArgv` has the value of the Worker that made it, and not the value of the program.
  test('made by a Worker with execArgv ["-e","1"], with a file as the program', async () => {
    const parent = startWorker({ execArgv: ["-e", "1"] }, "", "./relay.cjs");
    using dir = tempDir("parse-args-worker", { ...files, "parent.cjs": parent });
    expect(await run(["parent.cjs"], { cwd: String(dir) })).toEqual(printed(printsAt1));
  });

  test('made by a Worker with execArgv ["--no-addons"], with bun -e <code> as the program', async () => {
    using dir = tempDir("parse-args-worker", files);
    const cmd = ["-e", startWorker({ execArgv: ["--no-addons"] }, "", "./relay.cjs")];
    expect(await run(cmd, { cwd: String(dir) })).toEqual(printed(printsAt2));
  });
});

// Node reads its parsed `--eval` option and not `process.execArgv`:
// https://github.com/nodejs/node/pull/60814
test("process.execArgv does not choose where the default args start", () => {
  const { argv, execArgv } = process;
  try {
    process.argv = [process.argv0, "script.js", "--foo"];
    for (const fake of [["-e", "0"], ["--eval", "0"], ["-p", "0"], ["--print", "0"], undefined]) {
      process.execArgv = fake as any;
      expect(parseArgs({ strict: false })).toEqual({ values: { __proto__: null, foo: true }, positionals: [] } as any);
    }
  } finally {
    process.argv = argv;
    process.execArgv = execArgv;
  }
});
