// Tests for what `bun lint` prints: without an ESLint or oxlint config file, the parts that stay the same with one, and
// what a terminal gets that a pipe does not.
import { afterAll, describe, expect, setDefaultTimeout, test } from "bun:test";
import { bunEnv, bunExe, isASAN, isDebug, isLinux, isWindows, tempDir } from "harness";
import { writeFileSync } from "node:fs";
import { join, sep } from "node:path";
import { endChildren, spawn } from "../children";

afterAll(endChildren);

// Most tests here start two or three `bun lint` at once, and twenty tests run at a time. In a debug build that takes
// longer than the five seconds a test has.
setDefaultTimeout(isDebug || isASAN ? 60_000 : 5_000);

// Disable AI agent and CI detection regardless of the environment the tests run in.
const env = {
  ...bunEnv,
  AGENT: "0",
  CLAUDECODE: undefined,
  REPL_ID: undefined,
  GITHUB_ACTIONS: undefined,
  GITHUB_WORKSPACE: undefined,
  NO_COLOR: undefined,
  FORCE_COLOR: undefined,
};

type Files = Record<string, string>;

const withoutDirectory = (text: string, dir: { toString(): string }) =>
  text.replaceAll(String(dir) + sep, "<dir>/").replaceAll(String(dir), "<dir>");
const withoutTime = (text: string) => text.replace(/ \[\d+(\.\d+)?m?s\]/g, "");

async function lint(files: Files, args: string[] = [], more: Record<string, string | undefined> = {}) {
  using dir = tempDir("bun-lint-output", files);
  await using proc = spawn({
    cmd: [bunExe(), "lint", ...args],
    env: { ...env, ...more },
    cwd: String(dir),
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  return { stdout: withoutDirectory(stdout, dir), stderr: withoutTime(stderr), exitCode };
}

// Some sandboxes have no pseudo-terminals. On Windows, ConPTY re-renders the screen, so escape sequences don't survive.
const hasTerminal = (() => {
  if (isWindows) return false;
  try {
    new Bun.Terminal({}).close();
    return true;
  } catch {
    return false;
  }
})();

/**
 * Runs `bun lint` the way a person does, with stdout and stderr both attached to a terminal. `report` is the file
 * that `-o` names.
 */
async function inTerminal(files: Files, args: string[] = [], more: Record<string, string | undefined> = {}) {
  using dir = tempDir("bun-lint-output", files);
  const decoder = new TextDecoder();
  let output = "";
  await using proc = spawn({
    cmd: [bunExe(), "lint", ...args],
    env: { ...env, TERM: "xterm-256color", ...more },
    cwd: String(dir),
    terminal: {
      cols: 100,
      rows: 40,
      data(_terminal, chunk) {
        output += decoder.decode(chunk, { stream: true });
      },
    },
  });
  const exitCode = await proc.exited;
  const named = args.indexOf("-o") + 1;
  const report = named > 0 ? await Bun.file(join(String(dir), args[named])).text() : "";
  return {
    output: withoutDirectory(output.replaceAll("\r\n", "\n"), dir),
    exitCode,
    report: withoutDirectory(report, dir),
  };
}

const link = (page: string, text: string) =>
  `\x1b]8;;https://bun.com/docs/lint/rules/${page}\x1b\\${text}\x1b]8;;\x1b\\`;
const withoutLinks = (text: string) => text.replace(/\x1b\]8;;[^\x1b]*\x1b\\/g, "");

const bad = "var a = 1;\ndebugger;\nconsole.log(a);\n";
const warnsAboutVar = ["--rule", "no-var: warn"];
const eslint = { "eslint.config.js": `export default [{ rules: { "no-debugger": "error", "no-var": "warn" } }];\n` };
const oxlint = { ".oxlintrc.json": `{ "rules": { "no-debugger": "error", "no-var": "warn" } }` };

describe.concurrent("without a config file", () => {
  test("the default format is pretty, which ends with a summary", async () => {
    const [byDefault, explicit] = await Promise.all([
      lint({ "a.js": bad }, warnsAboutVar),
      lint({ "a.js": bad }, [...warnsAboutVar, "-f", "pretty"]),
    ]);
    expect(byDefault.stdout).toBe(
      [
        "1 | var a = 1;",
        "    ^",
        "warn: Unexpected var, use let or const instead.  no-var",
        "   at a.js:1:1",
        "",
        "1 | var a = 1;",
        "2 | debugger;",
        "    ^",
        "error: Unexpected 'debugger' statement.  no-debugger",
        "    at a.js:2:1",
        "",
        "2 problems (1 error, 1 warning)",
        "1 can be fixed with --fix",
        "",
      ].join("\n"),
    );
    expect(byDefault.stderr).toBe("Linted 1 file\n");
    expect(byDefault.exitCode).toBe(1);
    expect(explicit).toEqual(byDefault);
  });

  test("a [lint] section in bunfig.toml doesn't change the default format", async () => {
    const { stdout, exitCode } = await lint({ "a.js": bad, "bunfig.toml": `[lint.rules]\n"no-var" = "warn"\n` });
    expect(stdout).toEndWith("\n\n2 problems (1 error, 1 warning)\n1 can be fixed with --fix\n");
    expect(exitCode).toBe(1);
  });

  test("the summary pluralizes its counts, and only mentions --fix if something is fixable", async () => {
    const [one, two] = await Promise.all([
      lint({ "a.js": "debugger;\n" }),
      lint({ "a.js": "var a = 1, b = 2;\nvar c = a + b;\nconsole.log(c);\n" }, warnsAboutVar),
    ]);
    expect(one.stdout).toEndWith("    at a.js:1:1\n\n1 problem (1 error, 0 warnings)\n");
    expect(one.exitCode).toBe(1);
    expect(two.stdout).toEndWith("   at a.js:2:1\n\n2 problems (0 errors, 2 warnings)\n2 can be fixed with --fix\n");
    expect(two.exitCode).toBe(0);
  });

  test("stdout is empty if there are no problems", async () => {
    const { stdout, stderr, exitCode } = await lint({ "a.js": "console.log(1);\n" });
    expect(stdout).toBe("");
    expect(stderr).toBe("✓ No problems in 1 file\n");
    expect(exitCode).toBe(0);
  });

  test("with --quiet, the summary only counts what's shown", async () => {
    const { stdout, exitCode } = await lint({ "a.js": bad }, [...warnsAboutVar, "--quiet"]);
    expect(stdout).not.toContain("no-var");
    expect(stdout).toEndWith("\n\n1 problem (1 error, 0 warnings)\n");
    expect(exitCode).toBe(1);
  });

  test("above 50 problems, identical ones are grouped and the summary still counts them all", async () => {
    const many = { "a.js": Buffer.alloc(10 * 60, "debugger;\n").toString(), "b.js": bad };
    const [grouped, all] = await Promise.all([lint(many, warnsAboutVar), lint(many, [...warnsAboutVar, "--all"])]);
    expect(grouped.stdout).toBe(
      [
        "1 | debugger;",
        "    ^",
        "error: Unexpected 'debugger' statement.  no-debugger",
        "    at a.js:1:1",
        "    61 times in 2 files",
        "        60  a.js:1",
        "         1  b.js:2",
        "",
        "1 | var a = 1;",
        "    ^",
        "warn: Unexpected var, use let or const instead.  no-var",
        "   at b.js:1:1",
        "",
        "bun lint --all  show every problem",
        "",
        "62 problems (61 errors, 1 warning)",
        "1 can be fixed with --fix",
        "",
      ].join("\n"),
    );
    expect(all.stdout.match(/Unexpected 'debugger' statement/g)).toHaveLength(61);
    expect(all.stdout).not.toContain("bun lint --all");
    expect(all.stdout).toEndWith("\n\n62 problems (61 errors, 1 warning)\n1 can be fixed with --fix\n");
  });

  test("-f stylish prints ESLint's format", async () => {
    const { stdout, exitCode } = await lint({ "a.js": bad }, [...warnsAboutVar, "-f", "stylish"]);
    expect(stdout).toBe(
      [
        "",
        "<dir>/a.js",
        "  1:1  warning  Unexpected var, use let or const instead  no-var",
        "  2:1  error    Unexpected 'debugger' statement           no-debugger",
        "",
        "✖ 2 problems (1 error, 1 warning)",
        "  0 errors and 1 warning potentially fixable with the `--fix` option.",
        "",
        "",
      ].join("\n"),
    );
    expect(exitCode).toBe(1);
  });

  test("an agent gets the agent format, and GitHub Actions gets annotations after the report", async () => {
    const [agent, actions] = await Promise.all([
      lint({ "a.js": "debugger;\n" }, [], { AGENT: "1" }),
      lint({ "a.js": "debugger;\n" }, [], { GITHUB_ACTIONS: "true" }),
    ]);
    expect(agent.stdout).toStartWith(`<error file="a.js" line="1" column="1" rule="no-debugger">`);
    expect(agent.stdout).not.toContain("1 problem");
    expect(actions.stdout).toEndWith(
      "\n\n1 problem (1 error, 0 warnings)\n" +
        "::error file=a.js,line=1,col=1,endLine=1,endColumn=10,title=no-debugger::Unexpected 'debugger' statement.\n",
    );
  });
});

describe.concurrent("with a config file", () => {
  test("ESLint config: the default format is stylish, and pretty has no summary", async () => {
    const [byDefault, stylish, pretty] = await Promise.all([
      lint({ ...eslint, "a.js": bad }),
      lint({ ...eslint, "a.js": bad }, ["-f", "stylish"]),
      lint({ ...eslint, "a.js": bad }, ["-f", "pretty"]),
    ]);
    expect(byDefault.stdout).toContain("\n✖ 2 problems (1 error, 1 warning)\n");
    expect(byDefault).toEqual(stylish);
    expect(pretty.stdout).toEndWith("error: Unexpected 'debugger' statement.  no-debugger\n    at a.js:2:1\n\n");
  });

  test("-c counts as a config file", async () => {
    const { stdout } = await lint({ "my.config.js": eslint["eslint.config.js"], "a.js": bad }, ["-c", "my.config.js"]);
    expect(stdout).toContain("\n✖ 2 problems (1 error, 1 warning)\n");
  });

  test("oxlint config: no summary, only oxlint's own last line", async () => {
    const { stdout } = await lint({ ...oxlint, "a.js": bad });
    expect(stdout).not.toContain("2 problems");
    expect(withoutTime(stdout)).toEndWith("\n\nLinted 1 file\n");
  });
});

describe.concurrent("rule names link to their docs pages", () => {
  const files = { "a.js": "debugger;\n" };
  const configs = { none: {}, eslint, oxlint };
  // Drops the last line, which has the run's duration.
  const lines = (text: string) => text.split("\n").filter(line => !line.includes("Linted "));

  test.skipIf(!hasTerminal).each([
    ["none", "pretty", "no-debugger"],
    ["none", "stylish", "no-debugger"],
    ["eslint", "pretty", "no-debugger"],
    ["eslint", "stylish", "no-debugger"],
    ["oxlint", "pretty", "no-debugger"],
    ["oxlint", "stylish", "eslint(no-debugger)"],
  ] as const)("in a terminal: %s, %s", async (config, format, name) => {
    const project = { ...configs[config], ...files };
    const [terminal, piped] = await Promise.all([
      inTerminal(project, ["-f", format]),
      lint(project, ["-f", format], { FORCE_COLOR: "1" }),
    ]);
    expect(terminal.output).toContain(link("eslint/no-debugger", name));
    // Apart from the links, it matches colored output in a pipe: these files have no control characters.
    expect(piped.stdout).toContain("\x1b[");
    expect(piped.stdout).not.toContain("\x1b]8");
    expect(lines(withoutLinks(terminal.output))).toEqual(lines(piped.stdout + piped.stderr));
  });

  test.skipIf(!hasTerminal)("the URL uses the plugin's docs directory, not its prefix", async () => {
    const { output } = await inTerminal({ "a.ts": "export const a: any = 1;\n" });
    expect(output).toContain(link("typescript/no-explicit-any", "@typescript-eslint/no-explicit-any"));
  });

  test.skipIf(!hasTerminal)("no links without colors or in an output file", async () => {
    const [plain, noColorFlag, toFile] = await Promise.all([
      inTerminal(files, [], { NO_COLOR: "1" }),
      inTerminal(files, ["--no-color"]),
      inTerminal(files, ["-o", "report.txt"]),
    ]);
    expect(plain.output).toContain("no-debugger");
    expect(noColorFlag.output).toContain("no-debugger");
    for (const { output } of [plain, noColorFlag, toFile]) expect(output).not.toContain("\x1b]8");
  });

  test.each(["pretty", "stylish"])("no links in a pipe: %s", async format => {
    const [plain, colored, colorFlag] = await Promise.all([
      lint(files, ["-f", format]),
      lint(files, ["-f", format], { FORCE_COLOR: "1" }),
      lint(files, ["-f", format, "--color"]),
    ]);
    expect(plain.stdout).not.toContain("\x1b");
    for (const { stdout } of [colored, colorFlag]) {
      expect(stdout).toContain("\x1b[");
      expect(stdout).not.toContain("\x1b]8");
      expect(Bun.stripANSI(stdout)).toBe(plain.stdout);
    }
  });
});

// `stylish` prints a path, a message and a rule name as ESLint or oxlint does. A terminal acts on the control
// characters in them, so a report that goes to a terminal has them as escape sequences. A pipe and an `-o` file get
// them as they are.
describe.concurrent("control characters in stylish", () => {
  // Each sequence turns off a style that nothing has turned on, so a failure that prints one does no harm. None of
  // them ends a style of the report: Node's `util.styleText`, which ESLint styles with, rewrites those.
  const files = {
    // In two rule names and in two keys. The rule `y` has a tab, and the key `c` the 8-bit form of `ESC [`.
    "a.js":
      String.raw`/* eslint "x\u001b[27m": 2, "y\tz": 2 */` +
      "\n" +
      String.raw`export default { "a\u001b[49m": 1, "a\u001b[49m": 2, "c\u009b49m": 3, "c\u009b49m": 4, b: 5, b: 6 };` +
      "\n",
    // In the name of a file, with a tab.
    "b\x1b[29m\tc.js": "debugger;\n",
    "d.js": ";\n",
  };
  // In a rule name and a message that the config chooses. The message also has line feeds and a carriage return.
  // ESLint takes `3 4` on a line for a position and prints `3:4`.
  const name = "no-restricted-syntax/n\x1b[23m";
  const options = { selector: "DebuggerStatement", message: "one\n3 4\ntwo\r\x01 5 6" };
  // A rule name after a message of two lines.
  const other = "no-restricted-syntax/m\x01 7 8";
  const otherOptions = { selector: "EmptyStatement", message: "one\ntwo" };
  const rules = { "no-dupe-keys": "error", [name]: ["error", options], [other]: ["error", otherOptions] };
  // Three configs with these rules. Only the first is a program, which takes a second to run in a debug build.
  const forEslint = { ...files, "eslint.config.js": `export default [{ rules: ${JSON.stringify(rules)} }];\n` };
  const forOxlint = { ...files, ".oxlintrc.json": JSON.stringify({ categories: { correctness: "off" }, rules }) };
  const withoutConfig = {
    ...files,
    "bunfig.toml": [
      "[lint.rules]",
      `"no-debugger" = "off"`,
      `"no-dupe-keys" = "error"`,
      `${JSON.stringify(name)} = ["error", { selector = "DebuggerStatement", message = ${JSON.stringify(options.message)} }]`,
      `${JSON.stringify(other)} = ["error", { selector = "EmptyStatement", message = ${JSON.stringify(otherOptions.message)} }]`,
      "",
    ].join("\n"),
  };
  const stylish = ["-f", "stylish"];
  const withoutSummary = (text: string) => text.split("\n").filter(line => !line.includes("Linted "));

  // The columns are as wide as what is shown. A message keeps its tabs and line feeds, and a name has none. On a
  // later line of a message, the digits of an escape sequence are not a position: `5 6` and `7 8` stay.
  const shownAsEslint = [
    "",
    "<dir>/a.js",
    String.raw`  1:1   error  Definition for rule 'x\x1b[27m' was not found  x\x1b[27m`,
    "  1:1   error  Definition for rule 'y\tz' was not found        " + String.raw`y\tz`,
    String.raw`  2:36  error  Duplicate key 'a\x1b[49m'                      no-dupe-keys`,
    String.raw`  2:71  error  Duplicate key 'c\u009b49m'                     no-dupe-keys`,
    String.raw`  2:94  error  Duplicate key 'b'                              no-dupe-keys`,
    "",
    String.raw`<dir>/b\x1b[29m\tc.js`,
    "  1:1  error  one",
    "3:4",
    String.raw`two\r\x01 5 6  no-restricted-syntax/n\x1b[23m`,
    "",
    "<dir>/d.js",
    "  1:1  error  one",
    String.raw`two  no-restricted-syntax/m\x01 7 8`,
    "",
    "✖ 7 problems (7 errors, 0 warnings)",
    "",
    "",
  ];
  const shownAsOxlint = [
    "",
    "<dir>/a.js",
    String.raw`  2:18  error  Duplicate key 'a\x1b[49m'  eslint(no-dupe-keys)`,
    String.raw`  2:54  error  Duplicate key 'c\u009b49m'  eslint(no-dupe-keys)`,
    "  2:88  error  Duplicate key 'b'  eslint(no-dupe-keys)",
    "",
    String.raw`<dir>/b\x1b[29m\tc.js`,
    "  1:1  error  one",
    "3 4",
    String.raw`two\r\x01 5 6  no-restricted-syntax(n\x1b[23m)`,
    "",
    "<dir>/d.js",
    "  1:1  error  one",
    String.raw`two  no-restricted-syntax(m\x01 7 8)`,
    "",
    "✖ 5 problems (5 errors, 0 warnings)",
    "",
  ];

  test.skipIf(!hasTerminal)("in a terminal they are escape sequences: ESLint's stylish", async () => {
    const [plain, noColorFlag, colored] = await Promise.all([
      inTerminal(withoutConfig, stylish, { NO_COLOR: "1" }),
      inTerminal(withoutConfig, [...stylish, "--no-color"]),
      inTerminal(withoutConfig, stylish),
    ]);
    expect(withoutSummary(plain.output)).toEqual(shownAsEslint);
    expect(withoutSummary(noColorFlag.output)).toEqual(shownAsEslint);
    // With colors, the only sequences are those of the report. The name in a link is escaped too.
    expect(colored.output).toContain("\x1b[4m<dir>/a.js\x1b[24m");
    expect(colored.output).toContain(link("eslint/no-restricted-syntax", String.raw`no-restricted-syntax/n\x1b[23m`));
    expect(withoutSummary(Bun.stripANSI(withoutLinks(colored.output)))).toEqual(shownAsEslint);
  });

  test.skipIf(!hasTerminal)("in a terminal they are escape sequences: by default with an ESLint config", async () => {
    const { output } = await inTerminal(forEslint, [], { NO_COLOR: "1" });
    expect(withoutSummary(output)).toEqual(shownAsEslint);
  });

  test.skipIf(!hasTerminal)("in a terminal they are escape sequences: oxlint's stylish", async () => {
    const [plain, colored] = await Promise.all([
      inTerminal(forOxlint, stylish, { NO_COLOR: "1" }),
      inTerminal(forOxlint, stylish),
    ]);
    expect(withoutSummary(plain.output)).toEqual(shownAsOxlint);
    expect(colored.output).toContain("\x1b[4m<dir>/a.js\x1b[0m");
    expect(colored.output).toContain(link("eslint/no-restricted-syntax", String.raw`no-restricted-syntax(n\x1b[23m)`));
    expect(withoutSummary(Bun.stripANSI(withoutLinks(colored.output)))).toEqual(shownAsOxlint);
  });

  // What is not a control character, and a tab and a line break of a message.
  test.skipIf(!hasTerminal)("in a terminal the rest of a path and of a message stays as it is", async () => {
    const unchanged = {
      "a.js": String.raw`export default { "\u00e9\u65e5\u672c\u{1F600}": 1, "\u00e9\u65e5\u672c\u{1F600}": 2, "q\"uote\\": 3, "q\"uote\\": 4, "t\tb": 5, "t\tb": 6, "r\r\nn": 7, "r\r\nn": 8 };`,
      "\u65e5\u672c.js": "debugger;\n",
    };
    const args = [...stylish, "--rule", "no-dupe-keys: error"];
    const [terminal, piped] = await Promise.all([
      inTerminal(unchanged, args, { NO_COLOR: "1" }),
      lint(unchanged, args),
    ]);
    expect(piped.stdout).toContain("<dir>/\u65e5\u672c.js\n");
    expect(piped.stdout).toContain("Duplicate key '\u00e9\u65e5\u672c\u{1F600}'");
    expect(piped.stdout).toContain(String.raw`Duplicate key 'q"uote\'`);
    expect(piped.stdout).toContain("Duplicate key 't\tb'");
    expect(piped.stdout).toContain("Duplicate key 'r\r\nn'");
    expect(withoutSummary(terminal.output)).toEqual(withoutSummary(piped.stdout + piped.stderr));
  });

  test.skipIf(!hasTerminal)("in a pipe and in an output file they stay as they are: ESLint's stylish", async () => {
    const [piped, colored, toFile] = await Promise.all([
      lint(withoutConfig, stylish),
      lint(withoutConfig, [...stylish, "--color"]),
      inTerminal(withoutConfig, [...stylish, "-o", "report.txt"]),
    ]);
    // The columns are as wide as ESLint counts them: without the sequences. And ESLint finds a position on every line.
    expect(piped.stdout).toBe(
      [
        "",
        "<dir>/a.js",
        "  1:1   error  Definition for rule 'x\x1b[27m' was not found    x\x1b[27m",
        "  1:1   error  Definition for rule 'y\tz' was not found  y\tz",
        "  2:36  error  Duplicate key 'a\x1b[49m'                        no-dupe-keys",
        "  2:71  error  Duplicate key 'c\u009b49m'                        no-dupe-keys",
        "  2:94  error  Duplicate key 'b'                        no-dupe-keys",
        "",
        "<dir>/b\x1b[29m\tc.js",
        "  1:1  error  one",
        "3:4",
        "two\r\x01 5:6  no-restricted-syntax/n\x1b[23m",
        "",
        "<dir>/d.js",
        "  1:1  error  one",
        "two  no-restricted-syntax/m\x01 7:8",
        "",
        "✖ 7 problems (7 errors, 0 warnings)",
        "",
        "",
      ].join("\n"),
    );
    // With colors, the report has the same bytes between its own sequences.
    expect(colored.stdout).toContain("Definition for rule 'x\x1b[27m' was not found    \x1b[2mx\x1b[27m\x1b[22m");
    expect(colored.stdout).toContain("Duplicate key 'a\x1b[49m'                        \x1b[2mno-dupe-keys\x1b[22m\n");
    expect(colored.stdout).toContain("\x1b[4m<dir>/b\x1b[29m\tc.js\x1b[24m\n");
    expect(colored.stdout).toContain("two\r\x01 \x1b[2m5:6\x1b[22m  \x1b[2mno-restricted-syntax/n\x1b[23m\x1b[22m\n");
    // The terminal has colors, and so has the file. The file is not the terminal: the same bytes, and no links.
    expect(toFile.report + "\n").toBe(colored.stdout);
  });

  test.skipIf(!hasTerminal)("in a pipe and in an output file they stay as they are: oxlint's stylish", async () => {
    const [piped, toFile] = await Promise.all([
      lint(forOxlint, stylish, { NO_COLOR: "1" }),
      inTerminal(forOxlint, [...stylish, "-o", "report.txt"], { NO_COLOR: "1" }),
    ]);
    expect(piped.stdout).toBe(
      [
        "",
        "<dir>/a.js",
        "  2:18  error  Duplicate key 'a\x1b[49m'  eslint(no-dupe-keys)",
        "  2:54  error  Duplicate key 'c\u009b49m'  eslint(no-dupe-keys)",
        "  2:88  error  Duplicate key 'b'  eslint(no-dupe-keys)",
        "",
        "<dir>/b\x1b[29m\tc.js",
        "  1:1  error  one",
        "3 4",
        "two\r\x01 5 6  no-restricted-syntax(n\x1b[23m)",
        "",
        "<dir>/d.js",
        "  1:1  error  one",
        "two  no-restricted-syntax(m\x01 7 8)",
        "",
        "✖ 5 problems (5 errors, 0 warnings)",
        "",
      ].join("\n"),
    );
    expect(toFile.report).toBe(piped.stdout);
  });

  // Linux takes a file name that is not UTF-8. A terminal that reads 8-bit controls takes the byte 0x9b for `ESC [`.
  test.skipIf(!hasTerminal || !isLinux)("a byte of a file name that is not UTF-8 is U+FFFD in a terminal", async () => {
    using dir = tempDir("bun-lint-output", {});
    const name = Buffer.concat([Buffer.from("a"), Buffer.from([0x9b]), Buffer.from("49m.js")]);
    writeFileSync(Buffer.concat([Buffer.from(String(dir) + sep), name]), "debugger;\n");
    const chunks: Uint8Array[] = [];
    await using toTerminal = spawn({
      cmd: [bunExe(), "lint", ...stylish],
      env: { ...env, TERM: "xterm-256color", NO_COLOR: "1" },
      cwd: String(dir),
      terminal: { cols: 100, rows: 40, data: (_terminal, chunk) => void chunks.push(chunk.slice()) },
    });
    await using toPipe = spawn({
      cmd: [bunExe(), "lint", ...stylish],
      env,
      cwd: String(dir),
      stdout: "pipe",
      stderr: "ignore",
    });
    const [written] = await Promise.all([toPipe.stdout.bytes(), toPipe.exited, toTerminal.exited]);
    const shown = Buffer.concat(chunks);
    // A pipe gets the name as the file system has it.
    expect(Buffer.from(written).includes(name)).toBe(true);
    expect(shown.includes(0x9b)).toBe(false);
    expect(shown.includes(`${sep}a\ufffd49m.js\r\n`)).toBe(true);
  });
});

describe.concurrent("--fix prints what it fixed", () => {
  const twice = "var a = 1;\nvar b = 2;\nconsole.log(a, b);\n";
  const noVar = ["--rule", "no-var: error"];

  test("counts the problems and the files", async () => {
    const [two, one, three] = await Promise.all([
      lint({ "a.js": twice, "b.js": "console.log(1);\n" }, ["--fix", ...noVar]),
      lint({ "a.js": "var a = 1;\nconsole.log(a);\n" }, ["--fix", ...noVar]),
      lint({ "a.js": twice, "b.js": "var a = 1;\nconsole.log(a);\n" }, ["--fix", ...noVar]),
    ]);
    expect(two).toEqual({ stdout: "", stderr: "Fixed 2 problems in 1 file\n✓ No problems in 2 files\n", exitCode: 0 });
    expect(one).toEqual({ stdout: "", stderr: "Fixed 1 problem in 1 file\n✓ No problems in 1 file\n", exitCode: 0 });
    expect(three.stderr).toBe("Fixed 3 problems in 2 files\n✓ No problems in 2 files\n");
  });

  test("prints it before the summary of what's left", async () => {
    const { stdout, stderr, exitCode } = await lint({ "a.js": "debugger;\n" + twice }, ["--fix", ...noVar]);
    expect(stdout).toEndWith("\n\n1 problem (1 error, 0 warnings)\n");
    expect(stderr).toBe("Fixed 2 problems in 1 file\nLinted 1 file\n");
    expect(exitCode).toBe(1);
  });

  test("counts problems fixed in later passes too", async () => {
    const { stderr } = await lint({ "a.js": "var a = 1;\nconsole.log(a);\n" }, [
      "--fix",
      ...noVar,
      "--rule",
      "prefer-const: error",
    ]);
    expect(stderr).toBe("Fixed 2 problems in 1 file\n✓ No problems in 1 file\n");
  });

  test("prints nothing if nothing was fixed or written", async () => {
    const [clean, unfixable, dry] = await Promise.all([
      lint({ "a.js": "console.log(1);\n" }, ["--fix"]),
      lint({ "a.js": "debugger;\n" }, ["--fix"]),
      lint({ "a.js": twice }, ["--fix-dry-run", ...noVar]),
    ]);
    expect(clean.stderr).toBe("✓ No problems in 1 file\n");
    expect(unfixable.stderr).toBe("Linted 1 file\n");
    expect(dry.stderr).toBe("✓ No problems in 1 file\n");
  });

  test("also with an ESLint or oxlint config, and oxlint's stdout stays the same", async () => {
    const [withEslint, withOxlint] = await Promise.all([
      lint({ ...eslint, "a.js": twice }, ["--fix"]),
      lint({ ...oxlint, "a.js": twice }, ["--fix"]),
    ]);
    expect(withEslint).toEqual({
      stdout: "",
      stderr: "Fixed 2 problems in 1 file\n✓ No problems in 2 files\n",
      exitCode: 0,
    });
    expect({ ...withOxlint, stdout: withoutTime(withOxlint.stdout) }).toEqual({
      stdout: "✓ No problems in 1 file, fixed 1\n",
      stderr: "Fixed 2 problems in 1 file\n",
      exitCode: 0,
    });
  });
});

describe.concurrent("code frames in pretty", () => {
  test("the ^ lines up with the problem, whatever characters come before it", async () => {
    const { stdout } = await lint({
      "a.js": `console.log("日本語", "😀"); debugger;\n`,
      "b.js": "{\n\t\tdebugger;\n}\n",
      "c.js": `console.log("é"); debugger;\r\n`,
    });
    expect(stdout.split("\n\n").slice(0, 3)).toEqual([
      [
        `1 | console.log("日本語", "😀"); debugger;`,
        `${" ".repeat(4 + 29)}^`,
        `error: Unexpected 'debugger' statement.  no-debugger`,
        `    at a.js:1:27`,
      ].join("\n"),
      [
        `1 | {`,
        `2 |   debugger;`,
        `      ^`,
        `error: Unexpected 'debugger' statement.  no-debugger`,
        `    at b.js:2:3`,
      ].join("\n"),
      [
        `1 | console.log("é"); debugger;`,
        `${" ".repeat(4 + 18)}^`,
        `error: Unexpected 'debugger' statement.  no-debugger`,
        `    at c.js:1:19`,
      ].join("\n"),
    ]);
  });

  test("a multi-line problem is shown at its first line", async () => {
    const { stdout } = await lint({ "a.js": "function f() {\n  return 1;\n  f(\n    2,\n  );\n}\nf();\n" });
    expect(stdout).toStartWith(
      ["1 | function f() {", "2 |   return 1;", "3 |   f(", "      ^", "warn: Unreachable code.  no-unreachable"].join(
        "\n",
      ),
    );
  });

  const filler = Buffer.alloc(150, "a").toString();
  const long = {
    "end.js": `console.log(1);\nconsole.log("${filler}"); debugger;\n`,
    "start.js": `debugger; console.log("${filler}");\n`,
  };

  test.skipIf(!hasTerminal)("a line wider than the terminal is cut to the part around the problem", async () => {
    const { output } = await inTerminal(long, [], { NO_COLOR: "1" });
    expect(output.split("\n\n").slice(0, 2)).toEqual([
      [
        `2 | …${filler.slice(0, 26)}"); debugger;`,
        `${" ".repeat(4 + 1 + 30)}^`,
        `error: Unexpected 'debugger' statement.  no-debugger`,
        `    at end.js:2:168`,
      ].join("\n"),
      [
        `1 | debugger; console.log("${filler.slice(0, 72)}…`,
        `    ^`,
        `error: Unexpected 'debugger' statement.  no-debugger`,
        `    at start.js:1:1`,
      ].join("\n"),
    ]);
  });

  test("lines aren't cut in a pipe", async () => {
    const { stdout } = await lint(long);
    expect(stdout).toContain(`\n2 | console.log("${filler}"); debugger;\n`);
    expect(stdout).toContain(`\n1 | debugger; console.log("${filler}");\n`);
  });

  test("warnings are yellow and errors are red", async () => {
    const { stdout } = await lint({ "a.js": bad }, warnsAboutVar, { FORCE_COLOR: "1" });
    expect(stdout).toContain("\x1b[33mwarn\x1b[0m");
    expect(stdout).toContain("\x1b[31merror\x1b[0m");
    expect(stdout).toContain("\x1b[31m1 error\x1b[0m");
    expect(stdout).toContain("\x1b[33m1 warning\x1b[0m");
  });

  test("a count of zero has no color", async () => {
    const { stdout } = await lint({ "a.js": "debugger;\n" }, [], { FORCE_COLOR: "1" });
    expect(stdout).toContain("\x1b[31m1 error\x1b[0m");
    expect(stdout).not.toContain("\x1b[33m0 warnings");
    expect(Bun.stripANSI(stdout)).toEndWith("\n\n1 problem (1 error, 0 warnings)\n");
  });
});

describe.concurrent("above 50 problems", () => {
  const names = Array.from({ length: 60 }, (_, i) => `let a${i};`).join("\n") + "\n";

  test("each rule's problems form one group, and errors come first", async () => {
    const { stdout, exitCode } = await lint({ "a.js": names, "b.js": "debugger;\n" }, [
      "--rule",
      "no-unused-vars: warn",
    ]);
    expect(stdout).toBe(
      [
        "1 | debugger;",
        "    ^",
        "error: Unexpected 'debugger' statement.  no-debugger",
        "    at b.js:1:1",
        "",
        "1 | let a0;",
        "        ^",
        "warn: 'a0' is defined but never used.  no-unused-vars",
        "   at a.js:1:5",
        "",
        "note: Remove it, or start its name with _ to keep it.",
        "",
        "    60 times in 1 file",
        "        60  a.js:1",
        "",
        "bun lint --all  show every problem",
        "",
        "61 problems (1 error, 60 warnings)",
        "",
      ].join("\n"),
    );
    expect(exitCode).toBe(1);
  });

  test("with a config file, only problems with the same message are grouped", async () => {
    const config = `export default [{ rules: { "no-unused-vars": "warn", "no-debugger": "error" } }];\n`;
    const { stdout } = await lint({ "eslint.config.js": config, "a.js": names, "b.js": "debugger;\n" }, [
      "-f",
      "pretty",
    ]);
    expect(stdout).toStartWith("1 | let a0;\n");
    expect(stdout).not.toContain(" times in ");
    expect(stdout).toContain("\n  and 19 more problems of 19 other kinds\n");
  });
});
