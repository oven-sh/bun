import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
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
  // Node has no `-e=`, `-p=` or `--print=`. They get what the other spellings get.
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
// what Node v26.3.0 prints for `node -i` with the same flags.
describe("parseArgs default args under --interactive", () => {
  const input =
    'process.argv = ["a", "b", "c"];' +
    ' console.log("R=" + JSON.stringify(require("node:util").parseArgs({ strict: false }).positionals))\n';
  const launches: [name: string, flags: string[], positionals: string[]][] = [
    ["--interactive -e 1", ["-e", "1"], ["b", "c"]],
    ["--interactive -e ''", ["-e", ""], ["c"]],
  ];

  // node:repl takes 5 seconds to start in a debug build.
  test.each(launches)(
    "bun %s",
    async (_, flags, positionals) => {
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
    },
    30_000,
  );
});

// Node keeps `--eval` per thread: a Worker has the value of the thread that made it, or the one
// in its own `execArgv`. Every expected value is what Node v26.3.0 returns in a `worker_threads`
// Worker with the same `argv` and `execArgv`.
describe("parseArgs default args in a Worker", () => {
  const files = {
    "worker.cjs": `
      const { positionals } = require("node:util").parseArgs({ strict: false });
      postMessage(positionals.map(arg => arg.split(/[\\\\/]/).pop()));
    `,
    "preload.cjs": "",
  };
  // Prints what parseArgs returns in a Worker that is given `options`.
  const startWorker = (options: { execArgv?: string[] }, more = "") =>
    `const worker = new Worker('./worker.cjs', { argv: ['zzz', 'yyy'], ...${JSON.stringify(options)}${more} });` +
    " worker.onmessage = event => console.log(JSON.stringify(event.data));" +
    " worker.onerror = event => { console.error(event.message); process.exitCode = 1; };";
  const slicedAt1 = JSON.stringify(["worker.cjs", "zzz", "yyy"]);
  const slicedAt2 = JSON.stringify(["zzz", "yyy"]);
  const execArgvs: [execArgv: string[] | undefined, stdout: string][] = [
    [undefined, slicedAt2],
    [[], slicedAt2],
    [["--eval", "1"], slicedAt1],
    [["--eval=1"], slicedAt1],
    [["-e", "1"], slicedAt1],
    [["-pe", "1"], slicedAt1],
    [["-p", "1"], slicedAt1],
    [["-p"], slicedAt2],
    [["--eval", ""], slicedAt2],
    // A print flag takes the next token as its code only when that token is not a flag and not empty.
    [["-p", "--no-addons"], slicedAt2],
    [["--eval=1", "-p", ""], slicedAt1],
    // A token after another flag is that flag's value, and the code of an eval flag is not a flag.
    [["-r", "node:path", "-e", "1"], slicedAt1],
    [["-e", "", "-e", "1"], slicedAt1],
    [["-e", "1", "-e", ""], slicedAt2],
    [["-e", "\u0000"], slicedAt1],
    // The flags end at a token that is not a flag and not a value, and at `--`.
    [["x", "-e", "1"], slicedAt2],
    [["--", "-e", "1"], slicedAt2],
  ];

  test.each(
    execArgvs.map(([execArgv, stdout]): [name: string, execArgv: string[] | undefined, stdout: string] => [
      execArgv ? `execArgv ${JSON.stringify(execArgv)}` : "no execArgv",
      execArgv,
      stdout,
    ]),
  )("with a file as the program and %s", async (_, execArgv, stdout) => {
    using dir = tempDir("parse-args-worker", { ...files, "parent.cjs": startWorker({ execArgv }) });
    expect(await run(["parent.cjs"], { cwd: String(dir) })).toEqual(printed(stdout));
  });

  const passOn = ", execArgv: process.execArgv";
  const evalParents: [name: string, cmd: string[], stdout: string][] = [
    ["-e <code>", ["-e", startWorker({})], slicedAt1],
    ["--eval=<code>", [`--eval=${startWorker({})}`], slicedAt1],
    ["--eval=<code> and execArgv []", [`--eval=${startWorker({ execArgv: [] })}`], slicedAt2],
    ["-pe <code>", ["-pe", `${startWorker({})} void 0`], `${slicedAt1}\nundefined`],
    // A Worker that is given `process.execArgv` gets what a Worker that inherits it gets.
    [
      "-r <file> -e <code> and execArgv: process.execArgv",
      ["-r", "./preload.cjs", "-e", startWorker({}, passOn)],
      slicedAt1,
    ],
    [
      "--print=<code> and execArgv: process.execArgv",
      [`--print=${startWorker({}, passOn)} void 0`],
      `${slicedAt1}\nundefined`,
    ],
  ];
  test.each(evalParents)("with bun %s as the program", async (_, cmd, stdout) => {
    using dir = tempDir("parse-args-worker", files);
    expect(await run(cmd, { cwd: String(dir) })).toEqual(printed(stdout));
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
