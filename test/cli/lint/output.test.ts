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

type Files = Record<string, string | Buffer>;

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

/**
 * A file where `no-restricted-syntax` reports `messages[i]` on line `i + 1`. Such a message is the whole text that
 * `stylish` measures.
 */
const withMessages = (messages: string[]) => {
  const restrictions = messages.map((message, i) => ({ selector: `Literal[value=${i}]`, message }));
  // levn, which reads the comment, takes `\\"` for an escaped quote.
  const options = JSON.stringify(["error", ...restrictions]).replaceAll("\\\\", "\\u005c");
  return messages.map((_, i) => `${i};\n`).join("") + `/* eslint no-restricted-syntax: ${options} */\n`;
};

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

  // ESLint pads a message to the length of `util.stripVTControlCharacters(message)`. This is what ESLint 10.12.0 prints
  // on Node.js v26.12.1, the version that Bun reports.
  test("-f stylish pads a message with escape sequences like ESLint", async () => {
    const messages: [message: string, length: number][] = [
      // A link that ends with ESC \, with ST and with BEL.
      ["\x1b]8;;https://example.com/\x1b\\docs\x1b]8;;\x1b\\", 4],
      ["\x1b]8;;https://example.com/\x9cdocs\x1b]8;;\x9c", 4],
      ["\x1b]8;;https://example.com/\x07docs\x1b]8;;\x07", 4],
      // Without a terminator, only `ESC ] 8 ; ; h` is a sequence.
      ["\x1b]8;;https://example.com/", 19],
      ["✓ \x1b[32mdone\x1b[39m 😀", 9],
      ["a\x1bb", 3],
      // Older versions of Node.js count these two differently: a link with parentheses, and parameters with colons.
      ["\x1b]8;;https://example.com/(a)\x07docs\x1b]8;;\x07", 4],
      ["\x1b[38:5:1mred\x1b[0m \x9b1mbold\x9b0m", 8],
      ["A message without a sequence", 28],
    ];
    const { stdout, exitCode } = await lint({ "a.js": withMessages(messages.map(it => it[0])) }, ["-f", "stylish"]);
    expect(stdout).toBe(
      [
        "",
        "<dir>/a.js",
        ...messages.map(
          ([message, length], i) => `  ${i + 1}:1  error  ${message}${"".padEnd(28 - length)}  no-restricted-syntax`,
        ),
        "",
        `✖ ${messages.length} problems (${messages.length} errors, 0 warnings)`,
        "",
        "",
      ].join("\n"),
    );
    expect(exitCode).toBe(1);
  });

  // Every place where a regular expression for escape sequences decides something. The expected lengths are those of
  // Node.js v26.12.1: https://github.com/nodejs/node/blob/v26.12.1/lib/internal/util/inspect.js#L288-L293
  test("-f stylish measures a message like util.stripVTControlCharacters", async () => {
    const ansi = new RegExp(
      "(?:\\u001B\\][\\s\\S]*?(?:\\u0007|\\u001B\\u005C|\\u009C))" +
        "|[\\u001B\\u009B][[\\]()#;?]*" +
        "(?:\\d{1,4}(?:[;:]\\d{0,4})*)?" +
        "[\\dA-PR-TZcf-nq-uy=><~]",
      "g",
    );
    const introducers = ["\x1b", "\x9b"];
    const terminators = ["\x07", "\x1b\\", "\x9c"];
    // BEL, ESC and the ASCII characters from the space on.
    const characters = ["\x07", "\x1b", ...Array.from({ length: 0x60 }, (_, i) => String.fromCharCode(0x20 + i))];
    const sequences: string[] = [];
    for (const start of introducers) {
      // Each character after the introducer, after a prefix, after one and two parameters, before a final byte, and
      // between two parameters.
      for (const c of characters) {
        sequences.push(start + c, start + "[" + c, start + "[1" + c, start + "[1;2" + c);
        sequences.push(start + c + "m", start + "[1" + c + "2m");
      }
      // One to six digits in the first parameter and in a later one.
      for (const digits of ["1", "12", "123", "1234", "12345", "123456", "12340"]) {
        for (const after of ["", "m", ";7m", "x", ":7x"]) {
          sequences.push(start + "[" + digits + after, start + "[8;" + digits + after, start + "[8:" + digits + after);
        }
      }
      // Parameters that no final byte follows.
      for (const parameters of ["[1;", "[1;2;", "[1;;2;;", "[12;34;x", "[1;2:3;x", "[;1", "[;;1;;", "1;2x", "?25"]) {
        sequences.push(start + parameters);
      }
    }
    for (const end of terminators) {
      sequences.push("\x1b]" + end, "\x1b]" + end + "x", "\x9b]8;;u" + end + "x");
      sequences.push("\x1b]8;;http://x/(a)" + end + "link\x1b]8;;" + end);
      for (const other of terminators) sequences.push("\x1b]a" + end + "b" + other + "c");
      // An ESC and a byte C2 that start no terminator, right before one and a character before one.
      sequences.push("\x1b]\x1b" + end + "x", "\x1b]a\x1bb" + end + "x", "\x1b]\xa9" + end + "x");
      // A sequence without a terminator before one with a terminator, and after one.
      sequences.push("\x1b]a\x1b]b" + end + "c", "x" + end + "\x1b]0;t", "\x1b]a" + end + "\x1b]8;;u");
      sequences.push(
        "\x1b]a" + end + "\x1b[31m\x1b]8;;u" + end,
        "\x1b]\u2713" + end + "x",
        "\x1b]\u{1f600}" + end + "x",
      );
    }
    sequences.push("\x1b]", "\x1b]x", "\x1b]0;title", "\x1b]8;;u\x1b", "\x1b]8;;u\\", "\x1b]8;;u\x1bx\\");
    sequences.push("\x1b]8;;u\x1b[0m", "\x1b]8;;u|\x9c|", "\x9b\x9c", "\x9c\x9b[0m", "\x9c");
    // Characters whose UTF-8 form has the byte C2, 9B or 9C, and characters that are two UTF-16 code units.
    for (const c of ["\xa9", "\xdb", "\u015b", "\u201b", "\u{1f6d1}", "\xdc", "\u201c", "\u2713", "\u{1f700}"]) {
      sequences.push(c + "[0m", c + "1", "\x1b]8;;" + c, "\x1b]8;;" + c + "x\x07y");
      sequences.push(c + "\x1b[0m" + c, c + "\x9b0m" + c);
    }
    const keys = [...new Set(sequences)];
    // Keys that aren't UTF-8. ESLint measures the text that it decodes them to.
    const bytes = ["\xe2\x9c\x1b[0m\x93", "\xc2\x1b[0mx", "\x9b0m", "\x1b]8;;u\x9cx", "\x1b]8;;u\xc2\x07x"].map(it =>
      Buffer.from(it, "latin1"),
    );
    const plain = Buffer.alloc(64, "a").toString();
    // A key is followed by a quote in its message. A custom message is the whole text, so a sequence can end it.
    const endings = ["\x1b", "\x9b", "\x1b[", "\x1b[1", "\x1b[12", "\x1b[1;", "\x1b[1;2", "\x1b[m"];
    endings.push("\x1b]8;;u", "\x1b]8;;u\x07", "\x1b]8;;u\x1b\\", "\x1b]8;;u\x9c", "\x1b]8;;u\x1b");

    const escaped = (text: string) => text.replace(/[^]/g, c => "\\u" + c.charCodeAt(0).toString(16).padStart(4, "0"));
    const duplicate = (key: Buffer) => [`({ "`, key, `": null, "`, key, `": null });\n`].map(it => Buffer.from(it));
    const source = [...keys.map(key => Buffer.from(escaped(key))), ...bytes, Buffer.from(plain)].flatMap(duplicate);
    const decoder = new TextDecoder();
    const messages = {
      "keys.js": [...keys, ...bytes.map(it => decoder.decode(it)), plain].map(key => `Duplicate key '${key}'`),
      "messages.js": [...endings.map(it => "x" + it), "A message without a sequence"],
    };
    const { stdout, exitCode } = await lint(
      { "keys.js": Buffer.concat(source), "messages.js": withMessages(messages["messages.js"]) },
      ["-f", "stylish"],
    );

    const lines = stdout.split("\n");
    /** The rows of `file` that aren't as wide as Node.js makes them. The last row has no sequence. */
    const wrong = (file: keyof typeof messages, rule: string) => {
      const rows = lines.slice(lines.indexOf(`<dir>/${file}`) + 1).slice(0, messages[file].length);
      const paddings = rows.map((row, i) => {
        const cell = row.slice(row.indexOf("  error  ") + 9, -(rule.length + 2));
        return row.endsWith("  " + rule) && cell.startsWith(messages[file][i])
          ? cell.length - messages[file][i].length
          : NaN;
      });
      const widest = messages[file].at(-1)!.length + paddings.at(-1)!;
      return messages[file].flatMap((message, i) => {
        const [length, expected] = [widest - paddings[i], message.replace(ansi, "").length];
        return length === expected ? [] : [{ message: JSON.stringify(message), length, expected }];
      });
    };
    expect({ keys: wrong("keys.js", "no-dupe-keys"), messages: wrong("messages.js", "no-restricted-syntax") }).toEqual({
      keys: [],
      messages: [],
    });
    const total = messages["keys.js"].length + messages["messages.js"].length;
    expect(stdout).toEndWith(`\n\n✖ ${total} problems (${total} errors, 0 warnings)\n\n`);
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
    // Apart from the links, it matches colored output in a pipe.
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
        "note: Remove it, or prefix it with _.",
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
