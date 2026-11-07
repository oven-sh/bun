// What the checked files have chosen, in the output of `bun check`: a message argument, a path, a source line, of the
// project and of an installed package. The one-line format is what `tsc --pretty false` prints, byte for byte. Every
// other format is Bun's own: there each of them has its control characters as escape sequences, and a message argument
// is on one line, so that a person or an agent who reads the report is not shown a line that the file made up.
//
// `::forged::` stands for such a line, and `\x1b[0m` for a command of the terminal: a failure of these tests, printed
// there, runs nothing.
//
// In a file of its own, with projects that load no library, and one test at a time, each with its formats at a time: the
// debug builds that a test starts then end within the five seconds of a test, which those of check.test.ts do not.
import { afterAll, describe, expect, test } from "bun:test";
import { bunExe, isWindows, tempDir } from "harness";
import { join } from "node:path";
import { endChildren, spawn } from "../children";
import { tsc, env as withoutAgent } from "./differential";

afterAll(endChildren);

type Dir = { toString(): string };
type Env = Record<string, string | undefined>;

const env = { ...withoutAgent, GITHUB_WORKSPACE: undefined };

async function run(root: Dir, cmd: string[], extra: Env = {}, cwd = String(root)) {
  await using proc = spawn({ cmd, cwd, env: { ...env, ...extra }, stdout: "pipe", stderr: "pipe" });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  // A `\` of the output stays: an escape sequence starts with one.
  const clean = (text: string) =>
    text
      .replaceAll(String(root).replaceAll("\\", "/"), "<dir>")
      .replace(/\[\d+(\.\d+)?m?s\]/g, "[time]")
      .trim();
  return { stdout: clean(stdout), stderr: clean(stderr), exitCode };
}
const bun = (root: Dir, args: string[], extra: Env = {}, cwd?: string) => run(root, [bunExe(), ...args], extra, cwd);

// A format of Bun's own is printable text and line breaks. Only the checked files have a control character or a
// bidirectional control, and only they start a line with `::forged::`.
const RAW_CONTROL = /[\x00-\x09\x0b-\x1f\x7f\x80-\x9f\u2028-\u202e\u2066-\u2069]/;
function expectEscaped(...printed: string[]) {
  for (const text of printed) {
    expect(text).not.toMatch(RAW_CONTROL);
    expect(text).not.toMatch(/^::forged::/m);
  }
}
// The formats that are Bun's own, then the one that is tsc's, of which the summary is Bun's own.
async function ownFormats(dir: Dir, args: string[] = []) {
  const own = await Promise.all([
    bun(dir, ["check", ...args, "--pretty"]),
    bun(dir, ["check", ...args], { AGENT: "1" }),
  ]);
  for (const it of own) expectEscaped(it.stdout, it.stderr);
  return own;
}
async function inEveryFormat(dir: Dir, args: string[] = []) {
  const [own, oneLine] = await Promise.all([ownFormats(dir, args), bun(dir, ["check", ...args, "--no-pretty"])]);
  expectEscaped(oneLine.stderr);
  return [...own, oneLine];
}
const lines = (...lines: string[]) => lines.join("\n");
/** The lines of `printed` that start like `start`. */
const of = (printed: string, start: RegExp) => printed.split("\n").filter(line => start.test(line));
/** Each line that has carets below it, and the carets. */
const marked = (printed: string) =>
  printed.split("\n").flatMap((line, i, all) => (/^ *\^+$/.test(line) ? [[all[i - 1], line]] : []));

// Instead of the library files, which a debug build takes seconds to read.
const globals = "Array<T> Boolean CallableFunction Function IArguments NewableFunction Number Object RegExp String"
  .split(" ")
  .map(name => `interface ${name} {}\n`)
  .join("");
const options = {
  strict: true,
  noEmit: true,
  target: "esnext",
  module: "esnext",
  moduleResolution: "bundler",
  noLib: true,
  types: [],
  skipLibCheck: true,
};
const config = (more: object = {}) => JSON.stringify({ compilerOptions: { ...options, ...more } });
const project = (files: Record<string, string | Buffer>) =>
  tempDir("bun-check-control", { "tsconfig.json": config(), "globals.d.ts": globals, ...files });

// What a name of a file or a directory has. Windows has no such name with a character below U+0020.
const inName = isWindows ? "\u202e\u009b" : "\n::forged::\x1b[0m";
const inNameEscaped = isWindows ? String.raw`\u202e\u009b` : String.raw`\n::forged::\x1b[0m`;

const wrong = `export const n: number = "s";\n`;
const ts2322 = `Type 'string' is not assignable to type 'number'.`;

describe("control characters that the checked files have chosen", () => {
  test("a message argument is on one line, in the workflow command too", async () => {
    using dir = project({
      "index.ts": String.raw`import "./x\u001b[0m\r\n</error>\n::forged::a";` + `\nexport {};\n`,
    });
    const [pretty, agent, oneLine] = await Promise.all([
      bun(dir, ["check", "--pretty"], { GITHUB_ACTIONS: "true" }),
      bun(dir, ["check"], { AGENT: "1" }),
      bun(dir, ["check"], { GITHUB_ACTIONS: "true" }),
    ]);
    const source = String.raw`1 | import "./x\u001b[0m\r\n</error>\n::forged::a";`;
    const message = String.raw`Cannot find module or type declarations for side-effect import of './x\x1b[0m\r\n</error>\n::forged::a'.`;
    const command = `::error file=index.ts,line=1,col=8,endLine=1,endColumn=47,title=TS2882::${message}`;
    expect(pretty.stdout).toBe(
      lines(source, `           ^`, `error: TS2882: ${message}`, `    at index.ts:1:8`, ``, command),
    );
    expect(agent.stdout).toBe(
      lines(
        `<error file="index.ts" line="1" column="8" code="TS2882">`,
        message,
        `<source>`,
        source,
        `           ^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^`,
        `2 | export {};`,
        `</source>`,
        `</error>`,
      ),
    );
    // Before it is the line of tsc's format.
    expect(oneLine.stdout.split("\n").at(-1)).toBe(command);
    expectEscaped(pretty.stdout, pretty.stderr, agent.stdout, agent.stderr, oneLine.stderr);
    expect([pretty.exitCode, agent.exitCode, oneLine.exitCode]).toEqual([1, 1, 1]);
  });

  // What the one line is for: the report has the diagnostics that Bun found, and no other.
  test("an argument does not read as another diagnostic", async () => {
    const madeUp = String.raw`\n    at trusted.ts:1:1\n\nerror: TS2322: made up\n</error>\n<error file="trusted.ts" line="1" column="1" code="TS2322">\nmade up`;
    using dir = project({ "index.ts": `import './a${madeUp}';\nexport {};\n` });
    const [pretty, agent] = await ownFormats(dir);
    const message = `Cannot find module or type declarations for side-effect import of './a${madeUp}'.`;
    expect(of(pretty.stdout, /^(error: |    at )/)).toEqual([`error: TS2882: ${message}`, `    at index.ts:1:8`]);
    expect(of(agent.stdout, /^(<\/?error|Cannot)/)).toEqual([
      `<error file="index.ts" line="1" column="8" code="TS2882">`,
      message,
      `</error>`,
    ]);
  });

  test.skipIf(!tsc)("the one-line format is what tsc prints", async () => {
    using dir = project({
      "index.ts": lines(
        String.raw`import "./x\u001b[0m\r\n</error>\n::forged::a";`,
        `const o = { a: 1 };`,
        String.raw`export const v = o["x\n::forged::c"];`,
        ``,
      ),
      [`b${inName}.ts`]: wrong,
    });
    const [ours, theirs] = await Promise.all([
      bun(dir, ["check", "--no-pretty", "--listFiles"]),
      run(dir, [tsc!, "--pretty", "false", "--listFiles"]),
    ]);
    expect(ours.stdout).toContain(`: error TS2882: `);
    expect(ours.stdout).toBe(theirs.stdout);
  });

  test("an argument with a control character and no line break", async () => {
    using dir = project({
      "index.ts": lines(
        String.raw`import "./x\u001b[0m\u0000\u007f\u009b\u2028";`,
        String.raw`import "./y\tz\rw";`,
        `const o = { a: 1 };`,
        String.raw`export const v = o["x\u001b[0m"];`,
        ``,
      ),
    });
    const [pretty, agent] = await ownFormats(dir);
    const messages = [
      String.raw`Cannot find module or type declarations for side-effect import of './x\x1b[0m\x00\x7f\u009b\u2028'.`,
      String.raw`Cannot find module or type declarations for side-effect import of './y\tz\rw'.`,
      String.raw`Element implicitly has an 'any' type because expression of type '"x\u001B[0m"' can't be used to index type '{ a: number; }'.`,
      String.raw`  Property 'x\x1b[0m' does not exist on type '{ a: number; }'.`,
    ];
    expect(of(pretty.stdout, /^(error|  Property)/)).toEqual([
      `error: TS2882: ${messages[0]}`,
      `error: TS2882: ${messages[1]}`,
      `error: TS7053: ${messages[2]}`,
      messages[3],
    ]);
    expect(of(agent.stdout, /^(Cannot|Element|  Property)/)).toEqual(messages);
  });

  test("only the elaboration starts a line of a message, and a related one has one line", async () => {
    using dir = project({
      "index.ts": lines(
        String.raw`interface A { "k\n::forged::b": number }`,
        String.raw`export const a: A = { "k\n::forged::b": "s" };`,
        `const o = { a: 1 };`,
        String.raw`export const v = o["x\n::forged::c"];`,
        ``,
      ),
    });
    const [pretty, agent] = await ownFormats(dir);
    const related = String.raw`The expected type comes from property 'k\n::forged::b' which is declared here on type 'A'`;
    const ts7053 = [
      String.raw`Element implicitly has an 'any' type because expression of type '"x\n::forged::c"' can't be used to index type '{ a: number; }'.`,
      String.raw`  Property 'x\n::forged::c' does not exist on type '{ a: number; }'.`,
    ];
    const source = [
      String.raw`1 | interface A { "k\n::forged::b": number }`,
      String.raw`2 | export const a: A = { "k\n::forged::b": "s" };`,
      `3 | const o = { a: 1 };`,
      String.raw`4 | export const v = o["x\n::forged::c"];`,
    ];
    expect(pretty.stdout).toBe(
      lines(
        ...source.slice(0, 2),
        `                          ^`,
        `error: TS2322: ${ts2322}`,
        `    at index.ts:2:23`,
        ``,
        `note: ${related}`,
        `   at index.ts:1:15`,
        ``,
        ...source.slice(1),
        `                     ^`,
        `error: TS7053: ${ts7053[0]}`,
        ts7053[1],
        `    at index.ts:4:18`,
      ),
    );
    expect(agent.stdout).toBe(
      lines(
        `<error file="index.ts" line="2" column="23" code="TS2322">`,
        ts2322,
        `<source>`,
        ...source.slice(0, 2),
        `                          ^^^^^^^^^^^^^^^^`,
        ...source.slice(2),
        `</source>`,
        `<related file="index.ts" line="1" column="15">${related}</related>`,
        `</error>`,
        `<error file="index.ts" line="4" column="18" code="TS7053">`,
        ...ts7053,
        `<source>`,
        ...source,
        `                     ^^^^^^^^^^^^^^^^^^^`,
        `</source>`,
        `</error>`,
      ),
    );
  });

  // The checker has its text as UTF-8, and the arguments as the file has them.
  test("an argument that is not UTF-8 is on one line too", async () => {
    const name = (start: string) => start + "\xe9" + String.raw`\n</error>\n::forged::a`;
    using dir = project({
      "index.ts": Buffer.from(
        lines(
          `import "${name("./x")}";`,
          `interface A { "${name("k")}": number }`,
          `export const a: A = { "${name("k")}": "s" };`,
          ``,
        ),
        "latin1",
      ),
    });
    using configured = project({
      "tsconfig.json": Buffer.from(`{"compilerOptions":{"noLib":true,"types":["${name("x")}"]}}`, "latin1"),
      "index.ts": `export {};\n`,
    });
    const [[pretty, agent], [configuredPretty, configuredForAgent]] = await Promise.all([
      ownFormats(dir),
      ownFormats(configured),
    ]);
    const shown = (start: string) => start + "\ufffd" + String.raw`\n</error>\n::forged::a`;
    const ts2882 = `Cannot find module or type declarations for side-effect import of '${shown("./x")}'.`;
    const related = `The expected type comes from property '${shown("k")}' which is declared here on type 'A'`;
    expect(of(pretty.stdout, /^(error|note)/)).toEqual([
      `error: TS2882: ${ts2882}`,
      `error: TS2322: ${ts2322}`,
      `note: ${related}`,
    ]);
    expect(of(agent.stdout, /^(Cannot|<related|<\/error)/)).toEqual([
      ts2882,
      `</error>`,
      `<related file="index.ts" line="2" column="15">${related}</related>`,
      `</error>`,
    ]);
    const ts2688 = [
      `Cannot find type definition file for '${shown("x")}'.`,
      `  The file is in the program because:`,
      `    Entry point of type library '${shown("x")}' specified in compilerOptions`,
    ];
    expect(configuredPretty.stdout).toStartWith(lines(`error: TS2688: ${ts2688[0]}`, ...ts2688.slice(1), ``));
    expect(configuredForAgent.stdout).toStartWith(lines(`<error code="TS2688">`, ...ts2688, `<related `));
  });

  // A message is in Bun's terms, `bun add -d` for `npm i --save-dev`. An argument with a line break is as the file has it.
  test("an argument with a line break and the words of npm", async () => {
    const name = String.raw`npm i --save-dev \n::forged::b`;
    using dir = project({
      "index.ts": lines(
        `interface A { "${name}": number }`,
        `export const a: A = { "${name}": "s" };`,
        `import "./${name}";`,
        ``,
      ),
    });
    using configured = project({
      "tsconfig.json": `{"compilerOptions":{"noLib":true,"types":["${name}"]}}`,
      "index.ts": `export {};\n`,
    });
    const [[pretty, agent], [configuredPretty, configuredForAgent]] = await Promise.all([
      ownFormats(dir),
      ownFormats(configured),
    ]);
    const related = `The expected type comes from property '${name}' which is declared here on type 'A'`;
    const ts2882 = `Cannot find module or type declarations for side-effect import of './${name}'.`;
    expect(of(pretty.stdout, /^(note|error: TS2882)/)).toEqual([`note: ${related}`, `error: TS2882: ${ts2882}`]);
    expect(of(agent.stdout, /^(<related|Cannot)/)).toEqual([
      `<related file="index.ts" line="1" column="15">${related}</related>`,
      ts2882,
    ]);
    const ts2688 = [
      `Cannot find type definition file for '${name}'.`,
      `  The file is in the program because:`,
      `    Entry point of type library '${name}' specified in compilerOptions`,
    ];
    expect(configuredPretty.stdout).toStartWith(lines(`error: TS2688: ${ts2688[0]}`, ...ts2688.slice(1), ``));
    expect(configuredForAgent.stdout).toStartWith(lines(`<error code="TS2688">`, ...ts2688, `<related `));
  });

  test("an error of the configuration file, with its elaboration", async () => {
    using dir = project({
      "tsconfig.json": String.raw`{"compilerOptions":{"noLib":true,"types":["x\n::forged::d"]}}`,
      "index.ts": `export {};\n`,
    });
    const [pretty, agent] = await ownFormats(dir);
    const ts2688 = [
      String.raw`Cannot find type definition file for 'x\n::forged::d'.`,
      `  The file is in the program because:`,
      String.raw`    Entry point of type library 'x\n::forged::d' specified in compilerOptions`,
    ];
    expect(pretty.stdout).toBe(
      lines(
        `error: TS2688: ${ts2688[0]}`,
        ...ts2688.slice(1),
        ``,
        String.raw`1 | {"compilerOptions":{"noLib":true,"types":["x\n::forged::d"]}}`,
        `                                              ^`,
        `note: File is entry point of type library specified here.`,
        `   at tsconfig.json:1:43`,
      ),
    );
    expect(agent.stdout).toBe(
      lines(
        `<error code="TS2688">`,
        ...ts2688,
        `<related file="tsconfig.json" line="1" column="43">File is entry point of type library specified here.</related>`,
        `</error>`,
      ),
    );
  });

  // TypeScript joins them with line feeds in one argument.
  test("the paths of a cycle of project references have a line each", async () => {
    const cycle = (name: string) => ({
      "tsconfig.json": JSON.stringify({ files: [], references: [{ path: `./${name}` }] }),
      [`${name}/tsconfig.json`]: JSON.stringify({
        compilerOptions: { ...options, composite: true, noEmit: false },
        files: ["a.ts"],
        references: [{ path: ".." }],
      }),
      [`${name}/a.ts`]: `export {};\n`,
    });
    using ordinary = tempDir("bun-check-control", cycle("a"));
    using named = tempDir("bun-check-control", cycle(`a${inName}`));
    const [[pretty, agent, oneLine], [namedPretty, namedForAgent]] = await Promise.all([
      inEveryFormat(ordinary, ["-b"]),
      ownFormats(named, ["-b"]),
    ]);
    const ts6202 = (name: string) => [
      `Project references may not form a circular graph. Cycle detected: <dir>/tsconfig.json`,
      `<dir>/${name}/tsconfig.json`,
    ];
    expect(oneLine.stdout).toBe(`error TS6202: ${lines(...ts6202("a"))}`);
    expect(pretty.stdout).toBe(`error: TS6202: ${lines(...ts6202("a"))}`);
    expect(agent.stdout).toBe(lines(`<error code="TS6202">`, ...ts6202("a"), `</error>`));
    expect(namedPretty.stdout).toBe(`error: TS6202: ${lines(...ts6202(`a${inNameEscaped}`))}`);
    expect(namedForAgent.stdout).toBe(lines(`<error code="TS6202">`, ...ts6202(`a${inNameEscaped}`), `</error>`));
  });

  test("a source line for an agent: the carets are under what is printed", async () => {
    const invalid = (bytes: number[], name: string) =>
      Buffer.concat([Buffer.from(`/* `), Buffer.from(bytes), Buffer.from(` */ export const ${name}: number = "s";\n`)]);
    using dir = project({
      "index.ts": Buffer.concat([
        Buffer.from(
          lines(
            `/*\x1b[0m*/ export const n: number = "s";`,
            `/* \u0085 caf\u00e9 \u202e */ export const m: number = "s";`,
            `declare function f(x: number): void;`,
            `f("a\x1b[0mb");`,
            "f(`a\x1b",
            "b`);",
            ``,
          ),
        ),
        // Not UTF-8: half a surrogate pair, and two sequences that end too early.
        invalid([0xed, 0xa0, 0x80], "a"),
        invalid([0xf0, 0x90, 0x80], "b"),
        invalid([0x1b, 0xe2, 0x82], "c"),
      ]),
    });
    // UTF-8 that is not ASCII, before an error and in one that ends on a later line.
    using wide = project({
      "index.ts": lines(
        `declare function f(x: number): void;`,
        "/* \u65e5\u672c\u8a9e */ f(`a",
        "b`);",
        "f(`caf\u00e9 \u{1f600}",
        "b`);",
        `f("\u65e5\u672c\u8a9e");`,
        ``,
      ),
    });
    const [[pretty, agent], [, wideForAgent]] = await Promise.all([ownFormats(dir), ownFormats(wide)]);
    expect(marked(wideForAgent.stdout)).toEqual([
      ["2 | /* \u65e5\u672c\u8a9e */ f(`a", `                ^^`],
      ["4 | f(`caf\u00e9 \u{1f600}", `      ^^^^^^^^`],
      [`6 | f("\u65e5\u672c\u8a9e");`, `      ^^^^^`],
    ]);
    const expected = [
      [String.raw`1 | /*\x1b[0m*/ export const n: number = "s";`, `                             ^`],
      [
        String.raw`2 | /* \u0085 caf` + `\u00e9 ` + String.raw`\u202e */ export const m: number = "s";`,
        `                                          ^`,
      ],
      [String.raw`4 | f("a\x1b[0mb");`, `      ^^^^^^^^^^^`],
      [String.raw`5 | f(` + "`" + String.raw`a\x1b`, `      ^^^^^^`],
      [`7 | /* \ufffd\ufffd\ufffd */ export const a: number = "s";`, `                           ^`],
      [`8 | /* \ufffd */ export const b: number = "s";`, `                         ^`],
      [String.raw`9 | /* \x1b` + `\ufffd */ export const c: number = "s";`, `                             ^`],
    ];
    expect(marked(agent.stdout)).toEqual(expected);
    // `--pretty` has its caret at the same place, where the line is UTF-8.
    expect(marked(pretty.stdout).slice(0, 2)).toEqual(expected.slice(0, 2));
  });

  test("a path: of an error, of its duplicates, in the summary, above the working directory", async () => {
    const name = `b${inName}.ts`;
    const shown = `b${inNameEscaped}.ts`;
    using two = project({ "a.ts": wrong, [name]: wrong, "sub/deep/README.md": "" });
    // More than 50 errors of more than 12 kinds: some are printed in full, with the places of the others like them.
    const imports = (count: number, of: (i: number) => number) =>
      Array.from({ length: count }, (_, i) => String.raw`import "./m${of(i)}\u001b[0m\n::forged::f";`);
    using many = project({
      "index.ts": lines(...imports(60, i => i % 20), `export {};`, ``),
      [name]: lines(...imports(2, () => 0), `export {};`, ``),
    });
    const [[pretty, agent, oneLine], [grouped, groupedForAgent], above] = await Promise.all([
      inEveryFormat(two),
      ownFormats(many),
      bun(two, ["check", "-p", "../..", "--pretty"], {}, join(String(two), "sub", "deep")),
    ]);
    const summary = lines(`Found 2 errors in 2 files, checked 2 files [time]`, ``, `  1  a.ts:1`, `  1  ${shown}:1`);
    expect([pretty.stderr, agent.stderr, oneLine.stderr]).toEqual([summary, summary, summary]);
    expect(agent.stdout).toContain(`\n<error file="${shown}" line="1" column="14" code="TS2322">\n`);
    expect(above.stdout).toContain(`\n    at <dir>/${shown}:1:14`);
    expectEscaped(above.stdout, above.stderr);

    const message = (i: number) =>
      String.raw`Cannot find module or type declarations for side-effect import of './m${i}\x1b[0m\n::forged::f'.`;
    expect(grouped.stdout).toContain(lines(`    5 times in 2 files`, `      3  index.ts:1`, `      2  ${shown}:1`, ``));
    expect(grouped.stdout.split("\n").filter(line => line.startsWith("  3  TS2882"))).toEqual(
      Array.from({ length: 8 }, (_, i) => `  3  TS2882  ${message(i + 12)}  index.ts:${i + 13}`),
    );
    expect(groupedForAgent.stdout).toContain(`\n<also>${shown}:2:8 index.ts:1:8 index.ts:21:8 index.ts:41:8</also>\n`);
  });

  // The name is printed with `\n` before `pm i --save-dev `: that is not the words of npm.
  test("a message in Bun's terms, of a module whose name has a line break", async () => {
    using dir = project({
      "index.ts": String.raw`import x from "#a\npm i --save-dev b";` + `\nexport { x };\n`,
      "package.json": JSON.stringify({ name: "p", imports: { "#a\npm i --save-dev b": "ab" } }),
      "node_modules/ab/package.json": JSON.stringify({ name: "ab", version: "1.0.0", main: "index.js" }),
      "node_modules/ab/index.js": `module.exports = 1;\n`,
    });
    const [pretty] = await ownFormats(dir);
    const shown = String.raw`#a\npm i --save-dev b`;
    expect(pretty.stdout).toBe(
      lines(
        `1 | import x from "${shown}";`,
        `                  ^`,
        `error: TS7016: Could not find a declaration file for module '${shown}'. '<dir>/node_modules/ab/index.js' implicitly has an 'any' type.`,
        `  Try \`bun add -d @types/ab\` if it exists or add a new declaration (.d.ts) file containing \`declare module '${shown}';\``,
        `    at index.ts:1:15`,
      ),
    );
  });

  test("what an installed package has chosen", async () => {
    using dir = project({
      "index.ts": `import { a } from "dep";\nexport { a };\n`,
      "node_modules/dep/package.json": JSON.stringify({ name: "dep", version: "1.0.0" }),
      "node_modules/dep/index.ts":
        String.raw`import "./x\u001b[0m\n</error>\n::forged::a";` + `\nexport const a = 1;\n`,
    });
    const [pretty, agent] = await ownFormats(dir);
    const message = String.raw`Cannot find module or type declarations for side-effect import of './x\x1b[0m\n</error>\n::forged::a'.`;
    expect(pretty.stdout).toEndWith(lines(`error: TS2882: ${message}`, `    at node_modules/dep/index.ts:1:8`));
    expect(agent.stdout).toStartWith(
      lines(`<error file="node_modules/dep/index.ts" line="1" column="8" code="TS2882">`, message, `<source>`),
    );
  });

  // These are in every format: `tsc` has no such message.
  test("the messages that are Bun's own", async () => {
    using dir = tempDir("bun-check-control", {
      [`cwd${inName}/below/tsconfig.json`]: config(),
      [`cwd${inName}/below/a.ts`]: `export const a = 1;\n`,
      [`empty${inName}/README.md`]: "",
    });
    const [above, here, nothing] = await Promise.all([
      bun(dir, ["check"]),
      bun(dir, ["check"], {}, join(String(dir), `cwd${inName}`)),
      bun(dir, ["check", `empty${inName}`]),
    ]);
    const below = (from: string, path: string) =>
      lines(
        `error: No tsconfig.json in '${from}' or above it. Below it:`,
        `  ${path}`,
        `To check one: bun check -p ${path}`,
        `To check everything below this directory: bun check .`,
      );
    expect(above.stdout).toBe(below(`<dir>`, `cwd${inNameEscaped}/below/tsconfig.json`));
    expect(here.stdout).toBe(below(`<dir>/cwd${inNameEscaped}`, `below/tsconfig.json`));
    expect(nothing.stdout).toBe(`error: Nothing to check: no TypeScript files in '<dir>/empty${inNameEscaped}'`);
  });

  test("the lines of --traceResolution, --listFiles and --explainFiles", async () => {
    const name = `b${inName}.ts`;
    const files = {
      "index.ts": String.raw`import "./x\u001b[0m\n::forged::h";` + `\nexport {};\n`,
      [name]: `export const b = 1;\n`,
    };
    using traced = project({ ...files, "tsconfig.json": config({ traceResolution: true, listFiles: true }) });
    using explained = project({ ...files, "tsconfig.json": config({ explainFiles: true }) });
    const [[pretty, agent], [explainedPretty, explainedForAgent]] = await Promise.all([
      ownFormats(traced),
      ownFormats(explained, ["--all"]),
    ]);
    const first = String.raw`======== Resolving module './x\x1b[0m\n::forged::h' from '<dir>/index.ts'. ========`;
    const listed = lines(`<dir>/b${inNameEscaped}.ts`, `<dir>/globals.d.ts`, `<dir>/index.ts`);
    for (const it of [pretty, agent]) {
      expect(it.stdout).toStartWith(`${first}\n`);
      expect(it.stdout).toEndWith(`\n${listed}`);
    }
    for (const it of [explainedPretty, explainedForAgent]) {
      expect(it.stdout).toContain(`\nb${inNameEscaped}.ts\n   Matched by default include pattern '**/*'\n`);
    }
  });

  test("the lines of the summary that name a path", async () => {
    const name = `a${inName}`;
    using notInstalled = project({
      [`packages/${name}/package.json`]: JSON.stringify({ name: "a", dependencies: { react: "1" } }),
      [`packages/${name}/index.ts`]: `import "react";\nexport {};\n`,
    });
    // The parser reads a run of `[]` in a loop, so nothing bounds the depth of the type.
    using tooDeep = project({ [`${name}.ts`]: `export type T = number${Buffer.alloc(200_000, "[]")};\n` });
    const [notes, errors] = await Promise.all([inEveryFormat(notInstalled), inEveryFormat(tooDeep)]);
    const shown = `packages/a${inNameEscaped}`;
    const note = `note: 1 dependency in ${shown}/package.json is not installed. Run: bun install --cwd=${shown}`;
    expect(notes.map(it => it.stderr.split("\n")[0])).toEqual([note, note, note]);
    const error = `error: ran out of stack in a${inNameEscaped}.ts. This is a bug in Bun: errors in this file may be missing.`;
    expect(errors.map(it => it.stderr.split("\n")[0])).toEqual([error, error, error]);
  });

  test("`bun build --check` prints what `bun check` prints, and `Bun.build` has the message that tsc has", async () => {
    using dir = project({
      "index.ts": lines(
        String.raw`interface A { "k\n::forged::b": number }`,
        String.raw`export const a: A = { "k\n::forged::b": "s" };`,
        `const o = { a: 1 };`,
        String.raw`export const v = o["x\u001b[0m\n::forged::k"];`,
        ``,
      ),
      "build.mjs": lines(
        `const result = await Bun.build({ entrypoints: ["./index.ts"], check: true, throw: false });`,
        `console.log(JSON.stringify(result.logs.map(log => log.message)));`,
        ``,
      ),
    });
    // The parser reads a run of `[]` in a loop, so nothing bounds the depth of the type.
    using tooDeep = project({ [`a${inName}.ts`]: `export type T = number${Buffer.alloc(200_000, "[]")};\n` });
    const [command, api, forAgent, incomplete] = await Promise.all([
      bun(dir, ["build", "--check", "./index.ts", "--outdir", "out"]),
      bun(dir, ["build.mjs"]),
      bun(dir, ["--check", "index.ts"], { AGENT: "1" }),
      bun(tooDeep, ["build", "--check", `./a${inName}.ts`, "--outdir", "out"]),
    ]);
    const related = String.raw`The expected type comes from property 'k\n::forged::b' which is declared here on type 'A'`;
    const first = String.raw`Element implicitly has an 'any' type because expression of type '"x\u001B[0m\n::forged::k"' can't be used to index type '{ a: number; }'.`;
    const second = String.raw`  Property 'x\x1b[0m\n::forged::k' does not exist on type '{ a: number; }'.`;
    expect(command.stderr).toContain(lines(`error: TS7053: ${first}`, second, `    at `));
    expect(command.stderr).toContain(`\nnote: TS6500: ${related}\n`);
    expect(forAgent.stderr).toContain(lines(`code="TS7053">`, first, second, `<source>`));
    expect(incomplete.stderr).toContain(
      `error: ran out of stack in <dir>/a${inNameEscaped}.ts. This is a bug in Bun: errors in this file may be missing.`,
    );
    expectEscaped(command.stderr, forAgent.stderr, incomplete.stderr);
    // What `logs` has is not printed.
    const raw = lines(first, `  Property 'x\x1b[0m`, `::forged::k' does not exist on type '{ a: number; }'.`);
    expect(JSON.parse(api.stdout)).toContainEqual(`TS7053: ${raw}`);
    expect([command, api, forAgent, incomplete].map(it => it.exitCode)).toEqual([1, 0, 1, 1]);
  });
});
