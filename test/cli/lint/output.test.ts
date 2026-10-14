// Tests for `bun lint` output without an ESLint or oxlint config file, and for the parts that stay the same with one.
import { afterAll, describe, expect, test } from "bun:test";
import { bunEnv, bunExe, isWindows, tempDir } from "harness";
import { sep } from "node:path";
import { endChildren, spawn } from "../children";

afterAll(endChildren);

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

/** Runs `bun lint` the way a person does, with stdout and stderr both attached to a terminal. */
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
  return { output: withoutDirectory(output.replaceAll("\r\n", "\n"), dir), exitCode };
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
    const [byDefault, named] = await Promise.all([
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
    expect(named).toEqual(byDefault);
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
    const [shown, piped] = await Promise.all([
      inTerminal(project, ["-f", format]),
      lint(project, ["-f", format], { FORCE_COLOR: "1" }),
    ]);
    expect(shown.output).toContain(link("eslint/no-debugger", name));
    // Apart from the links, it matches colored output in a pipe.
    expect(piped.stdout).toContain("\x1b[");
    expect(piped.stdout).not.toContain("\x1b]8");
    expect(lines(withoutLinks(shown.output))).toEqual(lines(piped.stdout + piped.stderr));
  });

  test.skipIf(!hasTerminal)("the URL uses the plugin's docs directory, not its prefix", async () => {
    const { output } = await inTerminal({ "a.ts": "export const a: any = 1;\n" });
    expect(output).toContain(link("typescript/no-explicit-any", "@typescript-eslint/no-explicit-any"));
  });

  test.skipIf(!hasTerminal)("no links without colors or in an output file", async () => {
    const [plain, refused, toFile] = await Promise.all([
      inTerminal(files, [], { NO_COLOR: "1" }),
      inTerminal(files, ["--no-color"]),
      inTerminal(files, ["-o", "report.txt"]),
    ]);
    expect(plain.output).toContain("no-debugger");
    expect(refused.output).toContain("no-debugger");
    for (const { output } of [plain, refused, toFile]) expect(output).not.toContain("\x1b]8");
  });

  test.each(["pretty", "stylish"])("no links in a pipe: %s", async format => {
    const [plain, colored, asked] = await Promise.all([
      lint(files, ["-f", format]),
      lint(files, ["-f", format], { FORCE_COLOR: "1" }),
      lint(files, ["-f", format, "--color"]),
    ]);
    expect(plain.stdout).not.toContain("\x1b");
    for (const { stdout } of [colored, asked]) {
      expect(stdout).toContain("\x1b[");
      expect(stdout).not.toContain("\x1b]8");
      expect(Bun.stripANSI(stdout)).toBe(plain.stdout);
    }
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
    const [ofEslint, ofOxlint] = await Promise.all([
      lint({ ...eslint, "a.js": twice }, ["--fix"]),
      lint({ ...oxlint, "a.js": twice }, ["--fix"]),
    ]);
    expect(ofEslint).toEqual({
      stdout: "",
      stderr: "Fixed 2 problems in 1 file\n✓ No problems in 2 files\n",
      exitCode: 0,
    });
    expect({ ...ofOxlint, stdout: withoutTime(ofOxlint.stdout) }).toEqual({
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
