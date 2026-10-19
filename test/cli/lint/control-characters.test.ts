// What the linted files have chosen, in the formats of `bun lint` that are Bun's own: `pretty` and `agent`. A control
// character of a message, a path or a source line is an escape sequence there. The formats of ESLint and oxlint print
// what they print.
//
// `::forged::` stands for a workflow command, which a runner of GitHub Actions takes from the start of a line, and
// `\x1b[0m` for a command of the terminal: a failure of these tests, printed there, runs nothing.
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
// bidirectional control, and only they start a line like a workflow command.
const RAW_CONTROL = /[\x00-\x09\x0b-\x1f\x7f\x80-\x9f\u2028-\u202e\u2066-\u2069]/;

/** What `bun lint` prints for `files` in the formats that are Bun's own: `pretty`, then `agent`, then what `more` adds. */
async function ownFormats(
  files: Record<string, string | Buffer>,
  exitCode: number,
  more: Record<string, string>[] = [],
) {
  using dir = tempDir("bun-lint-control", files);
  const printed = [{}, { AGENT: "1" }, ...more].map(async extra => {
    await using proc = spawn({
      cmd: [bunExe(), "lint"],
      env: { ...env, ...extra },
      cwd: String(dir),
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
  });
  return await Promise.all(printed);
}
const lines = (...lines: string[]) => lines.join("\n");

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

  // A rule has no arguments when its message is printed: each line break of the message is one, `\n` or `\r\n`.
  test("a message keeps its line breaks", async () => {
    const files = {
      "a.ts": `export let f: Function;\n`,
      "b.js": String.raw`const o = { "a\r\nb": 1, "a\r\nb": 2 };` + `\nexport default o;\n`,
    };
    const [pretty, agent, annotated] = await ownFormats(files, 1, [{ GITHUB_ACTIONS: "true" }]);
    const message = [
      "The `Function` type accepts any function-like value.",
      "Prefer explicitly defining any function parameters and return type.",
    ];
    expect(pretty).toContain(lines(`warn: ${message[0]}`, `${message[1]}  @typescript-eslint/no-unsafe-function-type`));
    expect(agent).toContain(lines(`>`, ...message, `<source>`));
    expect(pretty).toContain(lines(`error: Duplicate key 'a`, `b'.  no-dupe-keys`, `    at b.js:1:26`));
    expect(agent).toContain(lines(`rule="no-dupe-keys">`, `Duplicate key 'a`, `b'.`, `<source>`));
    expect(annotated).toContain(`,title=no-dupe-keys::Duplicate key 'a%0Ab'.`);
  });
});
