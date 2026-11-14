// What the linted files have chosen, in the formats of `bun lint` that are Bun's own: `pretty` and `agent`, and the
// layout of `pretty` that a project with a configuration of oxlint has by default. A control character of a message, a
// rule name, a path or a source line is an escape sequence there. The formats of ESLint and oxlint print what they print.
//
// `::forged::` stands for a line that the file made up, and `\x1b[0m` for a command of the terminal: a failure of these
// tests, printed there, runs nothing.
import { afterAll, describe, expect, test } from "bun:test";
import { bunEnv, bunExe, isWindows, tempDir } from "harness";
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
  NO_COLOR: "1",
  FORCE_COLOR: undefined,
};

// A format of Bun's own is printable text and line breaks. Only the linted files have a control character or a
// bidirectional control, and only they start a line with `::forged::`.
const RAW_CONTROL = /[\x00-\x09\x0b-\x1f\x7f\x80-\x9f\u2028-\u202e\u2066-\u2069]/;

/** What `bun lint` prints in `dir`, in a format that is Bun's own. */
async function printed(dir: string, exitCode: number, extra: Record<string, string> = {}) {
  await using proc = spawn({
    cmd: [bunExe(), "lint"],
    env: { ...env, ...extra },
    cwd: dir,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exited] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  for (const text of [stdout, stderr]) {
    expect(text).not.toMatch(RAW_CONTROL);
    expect(text).not.toMatch(/^::forged::/m);
  }
  expect(exited).toBe(exitCode);
  return stdout.trimEnd();
}

/** What `bun lint` prints for `files` in the formats that are Bun's own: `pretty`, then `agent`, then what `more` adds. */
async function ownFormats(
  files: Record<string, string | Buffer>,
  exitCode: number,
  more: Record<string, string>[] = [],
) {
  using dir = tempDir("bun-lint-control", files);
  return await Promise.all([{}, { AGENT: "1" }, ...more].map(extra => printed(String(dir), exitCode, extra)));
}
const lines = (...lines: string[]) => lines.join("\n");
/** Each line that has carets below it, and the carets. */
const marked = (printed: string) =>
  printed.split("\n").flatMap((line, i, all) => (/^ *\^+$/.test(line) ? [[all[i - 1], line]] : []));

// What a name of a file has. Windows has no such name with a character below U+0020.
const inName = isWindows ? "\u202e\u009b" : "\n::forged::\x1b[0m";
const inNameEscaped = isWindows ? String.raw`\u202e\u009b` : String.raw`\n::forged::\x1b[0m`;

describe.concurrent("control characters that the linted files have chosen", () => {
  test("in a message and in the source line, with the carets under what is printed", async () => {
    const files = { "a.js": `const o = { "a\x1b[0m": 1, "a\x1b[0m": 2 };\nexport default o;\n` };
    const [pretty, agent, annotated] = await ownFormats(files, 1, [{ GITHUB_ACTIONS: "true" }]);
    const source = String.raw`1 | const o = { "a\x1b[0m": 1, "a\x1b[0m": 2 };`;
    const message = String.raw`Duplicate key 'a\x1b[0m'.`;
    const help = `Only the last one counts. The first is on line 1.`;
    expect(pretty).toBe(
      lines(
        source,
        `                               ^`,
        `error: ${message}  no-dupe-keys`,
        `    at a.js:1:25`,
        ``,
        `note: ${help}`,
        ``,
        `1 problem (1 error, 0 warnings)`,
      ),
    );
    expect(agent).toBe(
      lines(
        `<error file="a.js" line="1" column="25" rule="no-dupe-keys">`,
        message,
        `<source>`,
        source,
        `                               ^^^^^^^^^^`,
        `2 | export default o;`,
        `</source>`,
        `<help>${help}</help>`,
        `</error>`,
      ),
    );
    // The workflow command after the report has the message too.
    expect(annotated).toBe(
      lines(pretty, `::error file=a.js,line=1,col=25,endLine=1,endColumn=32,title=no-dupe-keys::${message}`),
    );
  });

  test("in a path: of a problem, and of the others like it", async () => {
    const name = `A${inName}.js`;
    const shown = `A${inNameEscaped}.js`;
    // More than 50 problems: one is printed in full, with the places of the others.
    const debuggers = Buffer.alloc(300, "debugger;\n").toString();
    const [pretty, agent] = await ownFormats({ [name]: debuggers, "b.js": debuggers }, 1);
    expect(pretty).toContain(
      lines(`    at ${shown}:1:1`, `    60 times in 2 files`, `        30  ${shown}:1`, `        30  b.js:1`, ``),
    );
    expect(agent).toStartWith(`<error file="${shown}" line="1" column="1" rule="no-debugger" times="60">\n`);
    expect(agent).toContain(`\n<also>${shown}:2:1 ${shown}:3:1 `);
  });

  // The printer has the finished message: each line break of it is one, `\n` or `\r\n`, and a tab is a space, as in the
  // excerpt. So is a line break that the file chose: that of a name, here of what a rule quotes.
  test("a message keeps its line breaks", async () => {
    const quoting = lines(`/* eslint no-implicit-coercion: "error" */`, `export const b = !!Object(`, `\t1,`, `);`, ``);
    const files = { "a.ts": `export let f: Function;\n`, "b.js": quoting.replaceAll("\n", "\r\n") };
    const [pretty, agent, annotated] = await ownFormats(files, 1, [{ GITHUB_ACTIONS: "true" }]);
    const message = [
      "The `Function` type accepts any function-like value.",
      "Prefer explicitly defining any function parameters and return type.",
    ];
    expect(pretty).toContain(lines(`warn: ${message[0]}`, `${message[1]}  @typescript-eslint/no-unsafe-function-type`));
    expect(agent).toContain(lines(`>`, ...message, `<source>`));
    const quoted = ["Unexpected implicit coercion encountered. Use `Boolean(Object(", " 1,", "))` instead."];
    expect(pretty).toContain(
      lines(`error: ${quoted[0]}`, quoted[1], `${quoted[2]}  no-implicit-coercion`, `    at b.js:2:18`),
    );
    expect(agent).toContain(lines(`>`, ...quoted, `<source>`));
    expect(annotated).toContain(`,title=no-implicit-coercion::${quoted.join("%0A")}`);
  });

  // A comment of the file turns on rules that there are none of. More than 50 problems of more than 12 kinds: some have
  // a line each.
  test("in the name of a rule: of a problem, in the line of a kind, in the workflow command", async () => {
    const rules = Array.from({ length: 60 }, (_, i) => String.raw`"r${i}\u001b\r\nz": 2`);
    const files = { "a.js": `/* eslint ${rules.join(", ")} */\nexport default 1;\n` };
    const [pretty, agent, annotated] = await ownFormats(files, 1, [{ GITHUB_ACTIONS: "true" }]);
    const rule = (i: number) => String.raw`r${i}\x1b\r\nz`;
    const message = (i: number) => [String.raw`Definition for rule 'r${i}\x1b`, `z' was not found.`];
    expect(pretty).toContain(lines(`error: ${message(0)[0]}`, `${message(0)[1]}  ${rule(0)}`, `    at a.js:1:1`));
    expect(pretty).toContain(`\n     1  ${message(12)[0]}  ${rule(12)}\n`);
    expect(agent).toStartWith(lines(`<error file="a.js" line="1" column="1" rule="${rule(0)}">`, ...message(0), ``));
    expect(annotated).toContain(`,title=${rule(0)}::${message(0).join("%0A")}\n`);
  });

  test("in the help of a rule, in what it suggests, and under a line that is not ASCII", async () => {
    const line = (bytes: string | number[]) =>
      Buffer.concat([Buffer.from(`/* `), Buffer.from(bytes as string), Buffer.from(` */ debugger;\n`)]);
    const files = {
      // Not UTF-8: half a surrogate pair, and two sequences that end too early.
      "a.js": Buffer.concat([
        line("\u65e5\u672c"),
        line([0xed, 0xa0, 0x80]),
        line([0xf0, 0x90, 0x80]),
        line([0x1b, 0xe2, 0x82]),
        line("\u{1f600}"),
        // A problem that ends on a later line.
        Buffer.from(
          lines(`/* \u65e5\u672c\u8a9e */ try {`, `  globalThis.x = 1;`, `} catch (e) {`, `  throw e;`, `}`, ``),
        ),
      ]),
      "b.js": lines(
        `/* eslint no-useless-escape: "error", no-empty-function: "error" */`,
        `export const s = "\\\x1b";`,
        `export const o = { "a\x1b[0m"() {} };`,
        ``,
      ),
    };
    const [pretty, agent] = await ownFormats(files, 1);
    expect(marked(agent).slice(0, 6)).toEqual([
      [`1 | /* \u65e5\u672c */ debugger;`, `             ^^^^^^^^^`],
      [`2 | /* \ufffd\ufffd\ufffd */ debugger;`, `              ^^^^^^^^^`],
      [`3 | /* \ufffd */ debugger;`, `            ^^^^^^^^^`],
      [String.raw`4 | /* \x1b` + `\ufffd */ debugger;`, `                ^^^^^^^^^`],
      [`5 | /* \u{1f600} */ debugger;`, `             ^^^^^^^^^`],
      [`6 | /* \u65e5\u672c\u8a9e */ try {`, `              ^^^^^`],
    ]);
    const help = String.raw`"\\x1b" is the same as "\x1b". Remove the backslash, or write \\ for a real one.`;
    expect(pretty).toContain(`\nnote: ${help}\n`);
    expect(agent).toContain(`\n<help>${help}</help>\n`);
    expect(agent).toContain(String.raw`<suggestion>Add comment inside empty method 'a\x1b[0m'.</suggestion>`);
  });

  // Such a project has the formats of oxlint, which print what oxlint prints. By default that is the layout of `pretty`.
  test("with a configuration of oxlint, by default: in a message and in what is said at each place", async () => {
    using dir = tempDir("bun-lint-control", {
      ".oxlintrc.json": "{}",
      "a.js": `class A {\n  "a\x1b[0m"() {}\n  "a\x1b[0m"() {}\n}\nexport default A;\n`,
    });
    const name = String.raw`"a\x1b[0m"`;
    expect(await printed(String(dir), 0)).toContain(
      lines(
        `warn: Duplicate class member: ${name}  no-dupe-class-members`,
        `   at a.js:2:3`,
        ``,
        `note: ${name} is previously declared here`,
        `note: The last declaration overwrites previous ones, remove one of them or rename if both should be retained`,
        `3 |   ${name}() {}`,
        `      ^`,
        `note: ${name} is re-declared here`,
        `   at a.js:3:3`,
      ),
    );
  });
});
