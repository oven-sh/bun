// Every way Bun reports a position in a source file, checked on one set of programs (source-positions-corpus.ts).
//
// The programs are written out once per variant, which moves their text without changing what it does. Then:
//   - `bun test --coverage` runs them: lines, functions, both reporters, the lines in the JUnit report, inline snapshots
//   - `bun` runs them, then runs each bundle `Bun.build` made of them: stack traces, call sites, error previews
//   - the source maps of the bundles are read directly: every word they map has to be the same word in the source
//   - a compiled executable runs them
//   - `bun` runs one program as it prints it and as it is written: a frame is on the same line in both
//   - `bun` runs a probe the same two ways: statements with a line break at one place after another
//   - `Bun.build` says where the programs that do not build are wrong
import { afterAll, describe, expect, test } from "bun:test";
import { bunEnv, bunExe, isWindows, tempDir } from "harness";
import { readFileSync } from "node:fs";
import { SourceMap } from "node:module";
import { join } from "node:path";
import { asWritten, broken, cases, snapshots } from "./source-positions-corpus";
import { generate } from "./source-positions-probe";

type Variant = {
  /** Goes before the code of each line that has some. */
  before?: string;
  /** Lines of code that go before the program. */
  above?: number;
  eol?: string;
  bom?: boolean;
  finalNewline?: boolean;
};
const variants: Record<string, Variant> = {
  plain: {},
  crlf: { eol: "\r\n" },
  bom: { bom: true, finalNewline: false },
  latin1: { before: "/*é*/ " },
  utf16: { before: "/*汉🎉*/ " },
  // More mappings than one window of the runtime's source maps has.
  below: { above: 100 },
};

/** `above`: how many frames of the file are below the one asked after. `minified`: where `minifyingLanes` have it. */
type Probe = { id: number; file: string; line: number; column: number; text: string; above: number; minified?: Probe };
type Program = { file: string; source: string; functions: string; counts: string[]; texts: string[] };
const probes: Probe[] = [];
const programs: Program[] = [];

for (const [variantName, { before = "", above = 0, eol = "\n", bom = false, finalNewline = true }] of Object.entries(
  variants,
)) {
  for (const [name, { functions, lines }] of Object.entries(cases)) {
    const file = `${variantName}/${name}`;
    const counts: string[] = Array(above).fill(" 1");
    const texts: string[] = Array(above).fill("globalThis.above = 0;");
    for (const line of lines.slice(1, -1).split("\n")) {
      const count = line.slice(0, 2);
      const text = line.slice(3);
      counts.push(count);
      // A line that starts inside a comment cannot have one put before it.
      texts.push(count === " -" || /^[^/]*\*\//.test(text) ? text : before + text);
    }

    const wanted: { id: number; text: string; above: number; minified?: string }[] = [];
    const source = (texts.join(eol) + (finalNewline ? eol : "")).replace(
      /\b(at|ran)(\?\.)?\(\)|\bcaught\(e, "([^"]+)"(?:, (\d))?(?:, "([^"]+)")?\)/g,
      (_, name, optional = "", thrownAt, above = "0", minified) => {
        const id = probes.length + wanted.length;
        wanted.push({ id, text: thrownAt ?? `${name}${optional}(${id})`, above: Number(above), minified });
        return thrownAt ? `caught(${id}, e)` : `${name}${optional}(${id})`;
      },
    );
    const found = (id: number, text: string, above: number): Probe => {
      const index = source.indexOf(text);
      const lineStart = source.lastIndexOf("\n", index) + 1;
      return { id, file, text, above, line: source.slice(0, index).split("\n").length, column: index - lineStart + 1 };
    };
    for (const { id, text, above, minified } of wanted) {
      probes.push({ ...found(id, text, above), ...(minified && { minified: found(id, minified, above) }) });
    }
    programs.push({ file, source: (bom ? "\uFEFF" : "") + source, functions, counts, texts: source.split(eol) });
  }
}

/** A text that is not one of the programs, in a variant. A comment can go before any of its lines. */
function moved(variantName: string, text: string) {
  const { before = "", above = 0, eol = "\n", bom = false, finalNewline = true } = variants[variantName];
  const lines = text.slice(1, -1).split("\n");
  return (
    (bom ? "\uFEFF" : "") +
    [...Array(above).fill("/* above */"), ...lines.map(line => before + line)].join(eol) +
    (finalNewline ? eol : "")
  );
}
const inEachVariant = <T>(name: string, value: (variantName: string) => T) =>
  Object.keys(variants).map(variantName => [`${variantName}/${name}`, value(variantName)] as const);

// Runs inside the programs. What it writes down is only what the runtime said.
const probeRuntime = `
const { getCallSites } = require("node:util");
const lanes = {};
const records = (lanes[process.env.SOURCE_POSITIONS_LANE] = { failed: {} });
function record(id, error) {
  const previous = records[id];
  if (previous) return void previous.count++;
  // An error that nothing catches is printed without its stack having been read.
  const preview = Bun.inspect(error, { colors: false });
  records[id] = { count: 1, preview, stack: error.stack, previewAfterStack: Bun.inspect(error, { colors: false }) };
  return records[id];
}
globalThis.at = function at(id) {
  const error = new Error("probe");
  Error.captureStackTrace(error, at);
  const first = record(id, error);
  if (!first) return;
  const prepareStackTrace = Error.prepareStackTrace;
  Error.prepareStackTrace = (_, [, site]) => site.getFileName() + ":" + site.getLineNumber() + ":" + site.getColumnNumber();
  first.callSite = new Error().stack;
  Error.prepareStackTrace = prepareStackTrace;
  const site = getCallSites(2)[1];
  first.getCallSites = site.scriptName + ":" + site.lineNumber + ":" + (site.columnNumber ?? site.column);
};
globalThis.ran = id => void (records[id] ??= { count: 0 }).count++;
globalThis.caught = (id, error) => void record(id, error);
globalThis.fails = {
  self() { return this; },
  call() { throw new Error("called"); },
  make() { return fails.call; },
  tag() { throw new Error("tagged"); },
  get value() { throw new Error("read"); },
};
globalThis.load = specifiers =>
  specifiers.reduce(
    (previous, specifier) => previous.then(() => import(specifier)).catch(e => void (records.failed[specifier] = String(e))),
    Promise.resolve(),
  );
globalThis.save = () => require("node:fs").writeFileSync(process.env.SOURCE_POSITIONS_OUT, JSON.stringify(lanes));
process.on("exit", save);
`;

const builds: Record<string, Partial<Bun.BuildConfig>> = {
  linked: { sourcemap: "linked" },
  inline: { sourcemap: "inline", format: "cjs" },
  minified: { sourcemap: "linked", minify: true },
  split: {
    sourcemap: "linked",
    splitting: true,
    minify: { whitespace: true },
    naming: { chunk: "[dir]/[name]-[hash].[ext]" },
  },
  // Text that is not ASCII is only left as it is for a browser.
  browser: {
    target: "browser",
    sourcemap: "linked",
    splitting: true,
    minify: { whitespace: true },
    naming: { chunk: "[dir]/[name]-[hash].[ext]" },
  },
};
// Bun reads the source map of what was built for it.
const bundles = Object.keys(builds).filter(name => name !== "browser");
// Minifying syntax makes one declaration of those in a row, and prints a key that holds a name behind a `.`. Bun does that to what it runs, but not under `--coverage`.
const minifyingLanes = ["run", "minified"];

type Record_ = {
  count: number;
  stack?: string;
  preview: string;
  previewAfterStack: string;
  callSite?: string;
  getCallSites?: string;
};
type Lane = { failed: Record<string, string> } & Record<number, Record_>;

const lanes: Record<string, Lane> = {};
const outputs: Record<string, { path: string; code: string; map: any; mappings: number[][] }[]> = {};

// The tests of the JUnit report. What is before `test` moves it the way the variants move the programs.
const testFile = [
  `import { afterAll, describe, test } from "bun:test";`,
  `type Erased = {`,
  `  a: number;`,
  `};`,
  `await load(${JSON.stringify(programs.map(({ file }) => `./${file}`))});`,
  `afterAll(save);`,
  `/*汉🎉*/ test("first", () => {});`,
  `describe("group", () => {`,
  `  const text = \`a`,
  `  b\`; test("second", () => {});`,
  `});`,
  ``,
].join("\n");

const lineBreakProbe = generate(readFileSync(join(import.meta.dir, "source-positions-probe-templates.txt"), "utf8"));

const dir = tempDir("source-positions", {
  ...Object.fromEntries(programs.map(({ file, source }) => [file, source])),
  ...Object.fromEntries(
    Object.entries(broken).flatMap(([name, text]) => inEachVariant(name, v => moved(v, text).replace("«", ""))),
  ),
  ...Object.fromEntries(inEachVariant("snapshots.test.ts", v => moved(v, snapshots).replace(/«.*?»/g, ""))),
  "probe.cjs": probeRuntime,
  "throws.cjs": `throw new Error("thrown while it loads");\n`,
  "all.test.ts": testFile,
  "entry.ts": programs.map(({ file }) => `import "./${file}";\n`).join(""),
  "compiled.ts": `import "./probe.cjs";\nawait import("./entry.ts");\n`,
  "run.ts": `await load(${JSON.stringify(programs.map(({ file }) => `./${file}`))});\n`,
  // Bun runs a file whose first line is `// @bun` as it is written. The first line of the other copy is empty.
  "printed/rows.mjs": asWritten,
  "written/rows.mjs": "// @bun" + asWritten,
  "printed/statements.mjs": lineBreakProbe.program,
  "written/statements.mjs": "// @bun" + lineBreakProbe.program.slice(lineBreakProbe.program.indexOf("\n")),
});
afterAll(() => dir[Symbol.dispose]());
const root = String(dir);

async function run(lane: string, cmd: string[]) {
  const out = lane + ".json";
  await using proc = Bun.spawn({
    cmd,
    cwd: root,
    env: { ...bunEnv, SOURCE_POSITIONS_OUT: join(root, out), SOURCE_POSITIONS_LANE: lane },
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  if (exitCode !== 0) throw new Error(`${cmd.join(" ")} exited with ${exitCode}\n${stdout}\n${stderr}`);
  Object.assign(lanes, JSON.parse(readFileSync(join(root, out), "utf8")));
  return stderr;
}

/** What each row of the program at `path` says of its frames, which it prints as JSON. */
async function framesOf(path: string): Promise<Record<string, string>> {
  await using proc = Bun.spawn({ cmd: [bunExe(), path], cwd: root, env: bunEnv, stdout: "pipe", stderr: "pipe" });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  if (exitCode !== 0) throw new Error(`${path} exited with ${exitCode}\n${stdout}\n${stderr}`);
  return JSON.parse(stdout);
}

async function bundle(name: string) {
  const { outputs: artifacts } = await Bun.build({
    entrypoints: [join(root, "entry.ts")],
    outdir: join(root, "out", name),
    target: "bun",
    ...builds[name],
  });
  outputs[name] = [];
  for (const artifact of artifacts) {
    if (artifact.kind === "sourcemap") continue;
    const code = await artifact.text();
    const inline = code.match(/\/\/# sourceMappingURL=data:application\/json;base64,(\S+)/)?.[1];
    const map = JSON.parse(
      inline ? Buffer.from(inline, "base64").toString() : readFileSync(artifact.path + ".map", "utf8"),
    );
    outputs[name].push({ path: artifact.path, code, map, mappings: decode(map.mappings) });
  }
  if (bundles.includes(name)) await run(name, [bunExe(), "--preload=./probe.cjs", `./out/${name}/entry.js`]);
}

// Everything runs once, here and not in a hook: a hook has the time limit of one test.
const compiled = join(root, isWindows ? "compiled.exe" : "compiled");
const [table, { logs: diagnostics }, printed, written, statementsPrinted, statementsWritten] = await Promise.all([
  run("test", [
    bunExe(),
    "test",
    "--preload=./probe.cjs",
    "--coverage",
    "--coverage-reporter=lcov",
    "--coverage-reporter=text",
    "--reporter=junit",
    "--reporter-outfile=junit.xml",
    "--update-snapshots",
    "./all.test.ts",
    ...inEachVariant("snapshots.test.ts", () => {}).map(([file]) => `./${file}`),
  ]),
  Bun.build({
    entrypoints: Object.keys(broken).flatMap(name => inEachVariant(name, () => {}).map(([file]) => join(root, file))),
    throw: false,
  }),
  framesOf("./printed/rows.mjs"),
  framesOf("./written/rows.mjs"),
  framesOf("./printed/statements.mjs"),
  framesOf("./written/statements.mjs"),
  run("run", [bunExe(), "--preload=./probe.cjs", "run.ts"]),
  ...Object.keys(builds).map(bundle),
  Bun.build({ entrypoints: [join(root, "compiled.ts")], compile: { outfile: compiled }, sourcemap: "inline" }).then(
    () => run("compiled", [compiled]),
  ),
]);
const lcov = readFileSync(join(root, "coverage", "lcov.info"), "utf8");
const junit = readFileSync(join(root, "junit.xml"), "utf8");

/** `path:line:column` at the end of what the runtime said, with the path relative to the programs. */
function position(said: string | undefined) {
  const [, path, line, column] = said?.match(/([^\s()]+):(\d+):(\d+)\)?$/) ?? [];
  if (!path) return String(said);
  return `${path.replaceAll("\\", "/").split("/").slice(-2).join("/")}:${line}:${column}`;
}

/** The text that the `^` of an error preview is under. A line of more than 1024 bytes is cut, and has no `^`. */
function underCaret(preview: string, text: string) {
  const lines = preview.split("\n");
  const caret = lines.findIndex(line => /^\s*\^$/.test(line));
  if (caret < 1) return lines.some(line => Buffer.byteLength(line) > 1024) ? text : preview;
  const under = lines[caret - 1].slice(lines[caret].indexOf("^"));
  // In most lanes `new X()` is at `new`, where V8 has it, until the stack of the error is read, and at `X` after that.
  return (under.startsWith("new " + text) ? under.slice(4) : under).slice(0, text.length);
}

describe.each(["test", "run", ...bundles, "compiled"])("%s", laneName => {
  // Once the stack of an error has been read, an executable reads the preview from the file on disk. It looks for the
  // path in the frame, which is relative to where it was built, from where it runs.
  const hasPreviewAfterStack = laneName !== "compiled";

  test("every program loads", () => {
    expect(lanes[laneName].failed).toEqual({});
  });

  test.each(Object.keys(variants))("%s: where a call or an error is", variantName => {
    const wrong: Record<string, unknown> = {};
    let checked = 0;
    for (const probe of probes) {
      const { id, file, line, column, text, above } = (minifyingLanes.includes(laneName) && probe.minified) || probe;
      if (!file.startsWith(variantName + "/")) continue;
      const said = lanes[laneName][id];
      if (!said?.stack) continue;
      checked++;
      const expected = `${file}:${line}:${column}`;
      const frames = said.stack.split("\n").slice(1).map(position);
      const frame = frames.flatMap((frame, index) => (frame.startsWith(file + ":") ? [index] : []))[above] ?? -1;
      const got = {
        stack: frames[frame],
        ...(said.callSite && { callSite: position(said.callSite), getCallSites: position(said.getCallSites) }),
        // The preview is of the first frame.
        preview: frame === 0 ? underCaret(said.preview, text) : text,
        previewAfterStack: frame === 0 && hasPreviewAfterStack ? underCaret(said.previewAfterStack, text) : text,
      };
      const want = {
        stack: expected,
        ...(said.callSite && { callSite: expected, getCallSites: expected }),
        preview: text,
        previewAfterStack: text,
      };
      if (!Bun.deepEquals(got, want)) wrong[`${expected} ${text}`] = got;
    }
    expect(wrong).toEqual({});
    expect(checked).toBeGreaterThan(0);
  });
});

// The rows of `asWritten` that have a frame on another line than as it is written: what is on both lines, and why.
const notAsWritten: Record<string, { printed: string; written: string; why: string }> = {
  of: {
    printed: "for (const each",
    written: "of 1) void each;",
    why: "the `of` is not mapped: an `--aot` executable cannot quote the head of a loop from a frame at its `of`",
  },
  memberOfName: {
    printed: "nothing",
    written: ".member;",
    why: "the `.` behind a name is not mapped: a name that is not declared is reported where that `.` is printed",
  },
  indexOfName: {
    printed: "nothing",
    written: "[0];",
    why: "the `[` behind a name is not mapped, for the same reason",
  },
  tagOfName: {
    printed: "tag",
    written: "`tagged`;",
    why: "the backquote behind a name is not mapped, for the same reason",
  },
  lastArgument: {
    printed: ");",
    written: "notDeclared",
    why: "a name is reported where it ends, and the `)` that is printed there is a line down",
  },
  spread: {
    printed: "1);",
    written: "String(...",
    why: "a spread is reported behind its `...`, where what it spreads is printed",
  },
  construct: {
    printed: "new",
    written: "empty.missing();",
    why: "`new` of what is no constructor is at the `new` once printed, and where its callee ends as written",
  },
  constantKey: {
    printed: "const once = empty.nothing();",
    written: "[key];",
    why: "a key that holds a name is printed behind a `.`, and the tree keeps no place for the `[` of such a member: the frame is where what `once` holds ends",
  },
  nameInQuotesOfConstant: {
    printed: 'const attrs = registry.get("six");',
    written: 'const indices = attrs["indices"];',
    why: "a name in quotes is printed behind a `.` as well, and the tree keeps no place for the `[` of such a member: the frame is where what `attrs` holds ends",
  },
  dotOnLineOfItsOwn: {
    printed: "empty.nothing()",
    written: ".",
    why: "the tree keeps no place for a `.`: it is looked for on the line of its name and no further",
  },
  callOfGroup: {
    printed: "(fails.make()",
    written: ")",
    why: "the tree keeps no place for the end of a callee: it is looked for on the line of the first argument and no further",
  },
  callOfFunctionWithArgumentsBelow: {
    printed: "fails.call();",
    written: "})(",
    why: "the end of a callee is not looked for on a line above the first argument, for the same reason",
  },
  commentAboveCallOfFunction: {
    printed: "fails.call();",
    written: "})",
    why: "nor is it looked for on a line above the `)` of a call without arguments",
  },
  optionalCallOfMemberWithArgumentsBelow: {
    printed: "fails.call",
    written: "?.(",
    why: "the tree keeps no place for the `?.` of a call: it is not looked for on a line above the first argument",
  },
  optionalCallWithArgumentsBelow: {
    printed: "[1]",
    written: "?.(",
    why: "nor is it behind a callee that is never null, where no `?.` is printed",
  },
};

test("a frame is on the line it is on when the program runs as it is written", () => {
  expect(asWritten).toMatch(/^[\x00-\x7f]+$/);
  const rows = Object.keys(written);
  expect(Object.keys(printed)).toEqual(rows);
  expect(Object.values(written)).not.toContain("did not throw");

  const text = asWritten.split("\n");
  const shown = (line: number) => `${line}: ${text[line - 1]?.trim()}`;
  /** The frames of `said` that the other copy has on another line. */
  const elsewhere = (said: string, other: string) => {
    const others = other.split(/ on |, /);
    const frames = said.split(/ on |, /).filter((frame, index) => frame !== others[index]);
    return frames.map(frame => (Number(frame) ? shown(Number(frame)) : frame)).join(", ");
  };
  /** The one line of a row that has `line` on it and nothing else. */
  const lineOf = (row: string, line: string) => {
    const name = text.findIndex(each => new RegExp(`^  (async )?${row}\\(.*\\{$`).test(each));
    const end = text.indexOf("  },", name);
    const found = text.flatMap((each, index) =>
      name < index && index < end && each.trim() === line ? [index + 1] : [],
    );
    return name >= 0 && found.length === 1 ? shown(found[0]) : `${row} has not one line that is ${line}`;
  };
  expect(
    Object.fromEntries(
      rows
        .filter(row => printed[row] !== written[row])
        .map(row => [
          row,
          { printed: elsewhere(printed[row], written[row]), written: elsewhere(written[row], printed[row]) },
        ]),
    ),
  ).toEqual(
    Object.fromEntries(
      Object.entries(notAsWritten).map(([row, lines]) => [
        row,
        { printed: lineOf(row, lines.printed), written: lineOf(row, lines.written) },
      ]),
    ),
  );
});

// The file lists the rows of the probe that have the frame of their function on another line than as they are written, each group below what keeps it there and what fixes it. A row that is right on main and wrong here is not in it.
test("a frame is on the line it is on as written wherever a statement is broken, but in the rows that are listed", () => {
  const listed = readFileSync(join(import.meta.dir, "source-positions-probe-not-as-written.txt"), "utf8")
    .split("\n")
    .filter(line => line && !line.startsWith("#"));
  const { rows } = lineBreakProbe;
  expect(Object.keys(statementsWritten)).toEqual(rows);
  expect(Object.keys(statementsPrinted)).toEqual(rows);
  // A `return` with a line break behind it returns nothing. Every other row throws, and has a frame of its function.
  const returnsNothing = rows.filter(row => row.includes(" :: return / "));
  expect({
    rows: rows.length,
    withoutFrame: rows.filter(row => !/^line \d+$/.test(statementsWritten[row])),
    thrown: returnsNothing.map(row => statementsWritten[row]),
  }).toEqual({ rows: 2633, withoutFrame: returnsNothing, thrown: Array(6).fill("no throw") });
  expect(rows.filter(row => statementsPrinted[row] !== statementsWritten[row]).sort()).toEqual(listed.toSorted());
});

// What the program above cannot hold: it is a module, and ASCII. `-->` starts a comment at the start of a line of a script only, and a line separator ends a line as a line feed does.
test("no token is looked for on a line above what stands behind it", async () => {
  const script = [
    "// filler",
    "function g() {} function f() {",
    "  return g().",
    "/* c */ --> see note.",
    "    name;",
    "}",
    "function behindLineSeparators() {",
    "  return g()\u2028.\u2028name;",
    "}",
    "function behindParagraphSeparators() {",
    "  return g()\u2029.\u2029name;",
    "}",
    "const frames = {};",
    "for (const row of [f, behindLineSeparators, behindParagraphSeparators]) {",
    "  try {",
    "    row();",
    '    frames[row.name] = "did not throw";',
    "  } catch (e) {",
    "    frames[row.name] = /script\\.cjs:(\\d+:\\d+)\\)?$/m.exec(e.stack)?.[1];",
    "  }",
    "}",
    "console.log(JSON.stringify(frames));",
    "",
  ].join("\n");
  using files = tempDir("source-positions-script", { "script.cjs": script });
  await using proc = Bun.spawn({
    cmd: [bunExe(), "script.cjs"],
    cwd: String(files),
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  // Each frame is at the `)` in front of the `.`, which is what is mapped last in front of it: the `.` that ends the comment is none of a member, and the `.` between two separators is on a line of its own.
  expect({ frames: stdout.trim(), stderr, exitCode }).toEqual({
    frames: JSON.stringify({ f: "3:12", behindLineSeparators: "8:12", behindParagraphSeparators: "13:12" }),
    stderr: "",
    exitCode: 0,
  });
});

// A bundle prints the name `Late` for `late.Late`. A name that is read too early is reported where it ends: a token mapped there would take its frame.
test("no token is mapped behind a member of an import that a bundle prints as a name", async () => {
  const reads = `import { late } from "./barrel.mjs";
export function read() {
  const rows = [
    () => {
      late.Late
        .member;
    },
    () => {
      late.Late
        [0];
    },
    () => {
      late.Late
        \`tagged\`;
    },
    () => {
      late["Late"]
        .member;
    },
  ];
  const frames = rows.map(row => {
    try {
      row();
      return "did not throw";
    } catch (e) {
      return e.name + " on " + /reads\\.mjs:(\\d+):\\d+\\)?$/m.exec(e.stack)?.[1];
    }
  });
  console.log(JSON.stringify(frames));
}
`;
  using files = tempDir("source-positions-bound-import", {
    "entry.mjs": `import "./reads.mjs";\n`,
    "barrel.mjs": `export * as late from "./late.mjs";\n`,
    // `read()` runs before the class is there.
    "late.mjs": `import { read } from "./reads.mjs";\nread();\nexport class Late {}\n`,
    "reads.mjs": reads,
  });
  const folder = String(files);
  const built = await Bun.build({
    entrypoints: [join(folder, "entry.mjs")],
    outdir: join(folder, "out"),
    target: "bun",
    sourcemap: "inline",
  });
  expect(built.success).toBe(true);
  await using proc = Bun.spawn({
    cmd: [bunExe(), join(folder, "out", "entry.js")],
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  expect(stderr).toBe("");
  const names = reads.split("\n").flatMap((line, index) => (/^ +late\W+Late\W*$/.test(line) ? [index + 1] : []));
  expect(JSON.parse(stdout)).toEqual(names.map(line => `ReferenceError on ${line}`));
  expect(names).toHaveLength(4);
  expect(exitCode).toBe(0);
});

// A bundle prints what it imports from a CommonJS module as a member of that module, `import_held.nothing`. That is no name, so a token behind it is mapped where it starts a line.
test("a token is mapped behind an import that a bundle prints as a member of a CommonJS module", async () => {
  const reads = `import { nothing, reader } from "./held.cjs";
import * as held from "./held.cjs";
const rows = [
  () => {
    nothing
      .member;
  },
  () => {
    reader
      ?.value;
  },
  () => {
    nothing
      [0];
  },
  () => {
    nothing
      \`tagged\`;
  },
  () => {
    held.nothing
      .member;
  },
  () => {
    held["nothing"]
      [0];
  },
  () => {
    nothing
      (1);
  },
];
const frames = rows.map(row => {
  try {
    row();
    return "did not throw";
  } catch (e) {
    return e.name + " on " + /reads\\.mjs:(\\d+):\\d+\\)?$/m.exec(e.stack)?.[1];
  }
});
console.log(JSON.stringify(frames));
`;
  using files = tempDir("source-positions-commonjs-import", {
    // A module that assigns `module.exports` stays a CommonJS module in a bundle.
    "held.cjs": `module.exports = { nothing: undefined, reader: { get value() { throw new Error("read"); } } };\n`,
    "reads.mjs": reads,
  });
  const folder = String(files);
  const built = await Bun.build({
    entrypoints: [join(folder, "reads.mjs")],
    outdir: join(folder, "out"),
    target: "bun",
    sourcemap: "inline",
  });
  expect(built.success).toBe(true);
  // A bundle that binds these imports to names prints no member, and has other frames.
  expect(await built.outputs[0].text()).toContain("import_held.nothing.member");
  await using proc = Bun.spawn({
    cmd: [bunExe(), join(folder, "out", "reads.js")],
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  const lines = reads.split("\n");
  const lineOf = (text: string, nth = 0) =>
    lines.flatMap((line, index) => (line.trim() === text ? [index + 1] : []))[nth];
  expect({ frames: JSON.parse(stdout), stderr, exitCode }).toEqual({
    frames: [
      `TypeError on ${lineOf(".member;")}`,
      `Error on ${lineOf("?.value;")}`,
      `TypeError on ${lineOf("[0];")}`,
      `TypeError on ${lineOf("`tagged`;")}`,
      `TypeError on ${lineOf(".member;", 1)}`,
      `TypeError on ${lineOf("[0];", 1)}`,
      // A call is reported where its callee ends, which is where the import is written.
      `TypeError on ${lineOf("nothing", 3)}`,
    ],
    stderr: "",
    exitCode: 0,
  });
});

// The `.` in front of each `b` is looked for from the line below it. What that costs must not grow with the lines above.
test("a file of 20,000 lines that end in U+2028 is printed with its source map", async () => {
  const statement = "  f().\u2028    b;\u2028";
  const count = 20_000;
  using files = tempDir("source-positions-line-separators", {
    "lines.js": Buffer.concat([
      Buffer.from("export function t(b, f) {\u2028"),
      Buffer.alloc(Buffer.byteLength(statement) * count, statement),
      Buffer.from("}\u2028"),
    ]),
  });
  const built = await Bun.build({ entrypoints: [join(String(files), "lines.js")], target: "bun", sourcemap: "inline" });
  expect(built.success).toBe(true);
  const text = await built.outputs[0].text();
  expect(text.split("f().b;").length - 1).toBe(count);
  expect(text).toContain("\n//# sourceMappingURL=data:application/json;base64,");
});

describe("bun test --coverage", () => {
  const reported = new Map<string, { functions: string; hits: Map<number, string> }>();
  for (const record of lcov.split("end_of_record\n")) {
    const file = record.match(/^SF:(.*)$/m)?.[1].replaceAll("\\", "/");
    if (!file) continue;
    reported.set(file, {
      functions: `${record.match(/^FNH:(\d+)$/m)![1]}/${record.match(/^FNF:(\d+)$/m)![1]}`,
      hits: new Map(Array.from(record.matchAll(/^DA:(\d+),(\d+)$/gm), ([, line, count]) => [Number(line), count])),
    });
  }

  const gutter = (counts: string[], texts: string[]) => counts.map((count, i) => `${count}|${texts[i]}`).join("\n");

  test.each(programs.map(({ file }) => file))("%s", file => {
    const { functions, counts, texts } = programs.find(program => program.file === file)!;
    const { functions: reportedFunctions, hits } = reported.get(file)!;
    expect({
      functions: reportedFunctions,
      lines: gutter(
        counts.map((_, i) => (hits.get(i + 1) ?? "-").padStart(2)),
        texts,
      ),
    }).toEqual({ functions, lines: gutter(counts, texts) });
  });

  // The counts in the corpus are not only what Bun printed one day: where a line is one call of `at`, the program counted.
  test("a line ran as often as the call that is all of it", () => {
    const wrong: string[] = [];
    for (const { id, file, line, text } of probes) {
      const { counts, texts } = programs.find(program => program.file === file)!;
      if (!text.startsWith("ran(") && !/^\s*(\/\*.*\*\/ )?at\(\d+\);$/.test(texts[line - 1])) continue;
      const counted = lanes.test[id]?.count ?? 0;
      if (Number(counts[line - 1]) !== counted) wrong.push(`${file}:${line} says ${counts[line - 1]}, ran ${counted}`);
    }
    expect(wrong).toEqual([]);
  });

  test("the table has the lines that did not run", () => {
    const wrong: Record<string, unknown> = {};
    for (const { file, counts, functions } of programs) {
      const row = table.split("\n").find(line =>
        line
          .replaceAll("\\", "/")
          .trimStart()
          .startsWith(file + " "),
      );
      const ranges: string[] = [];
      counts.forEach((count, i) => {
        if (count !== " 0") return;
        if (counts[i - 1] === " 0") ranges[ranges.length - 1] = `${ranges[ranges.length - 1].split("-")[0]}-${i + 1}`;
        else ranges.push(String(i + 1));
      });
      const executable = counts.filter(count => count !== " -");
      const [hit, found] = functions.split("/").map(Number);
      const want = [
        (found ? (hit / found) * 100 : 100).toFixed(2),
        (executable.length
          ? (executable.filter(count => count !== " 0").length / executable.length) * 100
          : 100
        ).toFixed(2),
        ranges.join(","),
      ];
      const got = row
        ?.split("|")
        .slice(1)
        .map(cell => cell.trim());
      if (!Bun.deepEquals(got, want)) wrong[file] = { got, want };
    }
    expect(wrong).toEqual({});
  });

  test("the JUnit report has the line of each test", () => {
    const lineOf = (name: string, text: string) =>
      `${name} ${text.slice(0, text.indexOf(`test("${name}"`)).split("\n").length}`;
    expect(
      Array.from(
        junit.matchAll(/<testcase name="(\w+)"[^>]* line="(\d+)"/g),
        ([, name, line]) => `${name} ${line}`,
      ).sort(),
    ).toEqual(
      [
        lineOf("first", testFile),
        lineOf("second", testFile),
        ...inEachVariant("", v => lineOf("snapshots", moved(v, snapshots))).map(([, line]) => line),
      ].sort(),
    );
  });

  test.each(Object.keys(variants))("%s: an inline snapshot is written where it is called", variantName => {
    expect(readFileSync(join(root, variantName, "snapshots.test.ts"), "utf8")).toBe(
      moved(variantName, snapshots).replace(/[«»]/g, ""),
    );
  });
});

test.each(Object.keys(variants))("%s: where a program that does not build is wrong", variantName => {
  const want: Record<string, unknown> = {};
  for (const [name, text] of Object.entries(broken)) {
    const before = moved(variantName, text).replace("\uFEFF", "").split("«")[0].split(/\r?\n/);
    want[`${variantName}/${name}`] = { line: before.length, column: before.at(-1)!.length + 1 };
  }
  const got: Record<string, unknown> = {};
  for (const { position } of diagnostics) {
    const file = position!.file.replaceAll("\\", "/").split("/").slice(-2).join("/");
    if (file in want) got[file] ??= { line: position!.line, column: position!.column };
  }
  expect(got).toEqual(want);
});

/** `[generatedLine, generatedColumn, source, originalLine, originalColumn]`, all from 0. */
function decode(mappings: string) {
  const digits = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
  const decoded: number[][] = [];
  let source = 0;
  let originalLine = 0;
  let originalColumn = 0;
  mappings.split(";").forEach((line, generatedLine) => {
    let generatedColumn = 0;
    for (const segment of line ? line.split(",") : []) {
      const fields: number[] = [];
      let value = 0;
      let shift = 0;
      for (const char of segment) {
        const digit = digits.indexOf(char);
        value += (digit & 31) << shift;
        shift += 5;
        if (digit & 32) continue;
        fields.push(value & 1 ? -(value >> 1) : value >> 1);
        value = shift = 0;
      }
      generatedColumn += fields[0];
      if (fields.length < 4) continue;
      decoded.push([
        generatedLine,
        generatedColumn,
        (source += fields[1]),
        (originalLine += fields[2]),
        (originalColumn += fields[3]),
      ]);
    }
  });
  return decoded;
}

describe.each(Object.keys(builds))("the source map of %s", name => {
  const wordAt = (line: string | undefined, column: number) =>
    /[\w$]/.test(line?.[column - 1] ?? "") ? undefined : line?.slice(column).match(/^[A-Za-z_$][\w$]{3,}/)?.[0];
  // A bundle without whitespace prints these words right in front of a value.
  const beforeValue =
    /(?:^|[^\w$.])(?:await|case|default|delete|do|else|extends|in|instanceof|new|of|return|throw|typeof|void|yield)$/;
  /** Whether a value can end where `before` does. A `[` there is of a subscript and a backquote of a tag, unless a block ends there: an array and a template are printed behind no value. */
  const endsValue = (before: string) => /[\w$)\]}"'`\u0080-\uffff]$/.test(before) && !beforeValue.test(before);
  /** Whether `const`, `let` or `var` declares what is printed behind `before`: right behind the word, or behind a `,` of theirs. A `[` or a `{` there opens a pattern. */
  const declares = (before: string) => {
    let flat = before;
    // What brackets close around is inside one value or one pattern.
    while (flat !== (flat = flat.replace(/\([^()[\]{}]*\)|\[[^()[\]{}]*\]|\{[^()[\]{}]*\}/g, "")));
    return /(?:^|[^\w$.])(?:const|let|var)(?: ?|(?![\w$])[^;()[\]{}]*, ?)$/.test(flat);
  };

  test("maps a word to the same word", () => {
    const wrong: string[] = [];
    let checked = 0;
    for (const { code, map, mappings } of outputs[name]) {
      const generated = code.split("\n");
      const originals = (map.sourcesContent as string[]).map(content => content.split(/\r?\n/));
      let previous = "";
      for (const [generatedLine, generatedColumn, source, originalLine, originalColumn] of mappings) {
        // Each line of a token that is on several starts with the mapping before it, again.
        const repeated = previous === (previous = `${source}:${originalLine}:${originalColumn}`);
        const word = wordAt(generated[generatedLine], generatedColumn);
        // A word that Bun made up, or renamed, is not in the source. The output of each member of an enum or of a
        // namespace starts with the name of the enum or of the namespace.
        if (repeated || !word || !map.sourcesContent[source].includes(word)) continue;
        if (map.sources[source].endsWith("lowered.ts")) continue;
        checked++;
        const original = originals[source][originalLine]?.slice(originalColumn, originalColumn + word.length);
        if (original !== word) {
          wrong.push(
            `${map.sources[source]}:${originalLine + 1}:${originalColumn + 1} is ${JSON.stringify(original)}, not ${word}`,
          );
        }
      }
    }
    expect(wrong).toEqual([]);
    expect(checked).toBeGreaterThan(0);
  });

  // A frame is also at a token that is no word. One that starts a line is mapped, and has to be mapped to where that token is written.
  test("maps a token that a frame is at to the same token", () => {
    const minifiesSyntax = builds[name].minify === true;
    // `(helper(["text", ...])` and a backquote: what is printed behind a tag whose text is not ASCII.
    const isCallOfTag = /^\([\w$]+\(\[\s*(?:(["'`])(?:(?!\1)[^\\]|\\.)*\1\s*,?\s*)+\]\)`/;
    const wrong: string[] = [];
    const found = {
      member: 0,
      optionalMember: 0,
      subscript: 0,
      tag: 0,
      tagCall: 0,
      call: 0,
      optionalCall: 0,
      arrayPattern: 0,
      objectPattern: 0,
      objectRest: 0,
    };
    for (const { code, map, mappings } of outputs[name]) {
      const generated = code.split("\n");
      const generatedStarts = [0, ...Array.from(code.matchAll(/\n/g), eol => eol.index + 1)];
      const contents = map.sourcesContent as string[];
      const lineStarts = contents.map(content => [
        0,
        ...Array.from(content.matchAll(/\r?\n/g), eol => eol.index + eol[0].length),
      ]);
      const locals = contents.map(content =>
        Array.from(content.matchAll(/\b(?:const|let) ([\w$]+)/g), ([, local]) => local),
      );
      const offsetOf = ([, , source, line, column]: number[]) => lineStarts[source][line] + column;
      mappings.forEach((mapping, index) => {
        const [generatedLine, generatedColumn, source, originalLine, originalColumn] = mapping;
        const line = generated[generatedLine];
        if (!".?[`{(".includes(line[generatedColumn] ?? " ")) return;
        const previous = mappings[index - 1];
        const at = offsetOf(mapping);
        // Each line of a token that is on several starts with the mapping before it, again.
        if (previous?.[2] === source && offsetOf(previous) === at) return;
        const before = line.slice(Math.max(0, generatedColumn - 400), generatedColumn);
        const printed = line.slice(generatedColumn, generatedColumn + 200);
        const writtenBefore = contents[source].slice(Math.max(0, at - 12), at);
        const written = contents[source].slice(at, at + 200);
        let token: keyof typeof found | undefined;
        let same: boolean;
        // A `[` that is left open behind what is mapped in front, outside a comment, is the one of the member: this one is in its key.
        const isInKey = () =>
          previous?.[2] === source &&
          /\[[^\]]*$/.test(contents[source].slice(offsetOf(previous) + 1, at).replace(/\/\*[^]*?\*\/|\/\/.*/g, ""));
        if (/^\??\.(?![.\d])/.test(printed)) {
          // Nothing else is mapped at a `.`, but a spread and a number that start with one.
          const punctuator = printed[0] === "?" ? "?." : ".";
          token = punctuator === "." ? "member" : "optionalMember";
          same = written.startsWith(punctuator) && !written.startsWith("..");
          // Minified, a `?.` behind what is never null is printed as a `.`.
          same ||= minifiesSyntax && written.startsWith("?.");
        } else if (printed[0] === "[") {
          // An array is mapped at its `[` as well, and nothing tells a list in a pattern or among parameters from one: neither is counted, and both are written `[`.
          if (declares(before)) token = "arrayPattern";
          else if (before.endsWith("?.") || endsValue(before)) token = "subscript";
          same = written[0] === "[" && !(token === "subscript" && isInKey());
        } else if (printed[0] === "`") {
          // A template without a tag is mapped where it starts, and so is a text that is printed as one.
          if (!endsValue(before)) return;
          token = "tag";
          same = written[0] === "`";
        } else if (printed[0] === "{") {
          // A block, a class and an object are mapped at their `{` as well, and not each of them is written with one: the attributes of an element are an object that is printed behind its tag and mapped at its `<`.
          const closesBehindRest = /^\{[^{}]*\.\.\.[\w$]+\s*\}/.test(printed);
          // Behind no declaration, a pattern is known by its rest, and is mapped only where it starts a line. An object that ends in a spread there is taken for one, and is written `{` as well.
          const startsLine = previous?.[2] !== source || previous[3] !== originalLine;
          if (declares(before)) token = "objectPattern";
          else if (closesBehindRest && startsLine) token = "objectRest";
          else return;
          same = written[0] === "{";
        } else if (printed[0] === "(" && before.endsWith("?.")) {
          token = "optionalCall";
          same = writtenBefore.endsWith("?.") && /^\s*\(/.test(written);
        } else if (
          printed[0] === "(" &&
          isCallOfTag.test(code.slice(generatedStarts[generatedLine] + generatedColumn))
        ) {
          // A bundle for Bun calls a tag whose text is not ASCII with what a helper makes of that text: the `(` of that call stands for the backquote.
          token = "tagCall";
          same = written[0] === "`";
        } else if (printed[0] === "(" && /[)\]}`]$/.test(before) && !/^\([^()]*\)\s*(?:\{|=>)/.test(printed)) {
          // Parameters are mapped at their `(` as well: a `{` or a `=>` is behind their `)`.
          token = "call";
          same = /[)\]}`]$/.test(writtenBefore) && /^\s*\(/.test(written);
          // Minified, a `?.` behind what is never null is not printed, and what a constant that is read once holds is printed in place of its name: that call is at the name.
          same ||=
            minifiesSyntax && (writtenBefore.endsWith("?.") || locals[source].includes(written.match(/^[\w$]+/)?.[0]!));
        } else {
          return;
        }
        if (token) found[token]++;
        if (same) return;
        const where = `${map.sources[source]}:${originalLine + 1}:${originalColumn + 1}`;
        const text = JSON.stringify(before.slice(-12) + printed.slice(0, 12));
        wrong.push(
          `${where} has ${JSON.stringify(written.slice(0, 12))} behind ${JSON.stringify(writtenBefore)}, not the ${token ?? "["} of ${text}`,
        );
      });
    }
    expect(wrong).toEqual([]);
    // The programs start a line with each kind, and nothing else is counted: a bundle that maps none of a kind fails.
    const missing = Object.entries(found).flatMap(([kind, count]) => (count ? [] : [kind]));
    // Text that is not ASCII is left as it is for a browser: that bundle calls no such tag.
    expect(missing).toEqual(name === "browser" ? ["tagCall"] : []);
  });

  test("maps finally and the { after it to the same", () => {
    const wrong: string[] = [];
    let checked = 0;
    for (const { path, code, map, mappings } of outputs[name]) {
      const originals = (map.sourcesContent as string[]).map(content => content.split(/\r?\n/));
      const originalOf = new Map(mappings.map(([line, column, ...original]) => [`${line}:${column}`, original]));
      const sourceFrom = (generatedLine: number, generatedColumn: number) => {
        const [source, line, column] = originalOf.get(`${generatedLine}:${generatedColumn}`) ?? [];
        return originals[source!]?.slice(line).join("\n").slice(column);
      };
      code.split("\n").forEach((line, generatedLine) => {
        for (const { 0: keyword, index } of line.matchAll(/\bfinally ?(?=\{)/g)) {
          checked++;
          const fromBrace = sourceFrom(generatedLine, index)?.match(/^finally\s*(\{[^]*)/)?.[1];
          if (!fromBrace || fromBrace !== sourceFrom(generatedLine, index + keyword.length))
            wrong.push(`${path}:${generatedLine + 1}:${index + 1}`);
        }
      });
    }
    expect(wrong).toEqual([]);
    expect(checked).toBeGreaterThan(0);
  });

  test("node:module's SourceMap finds each call", () => {
    const wrong: string[] = [];
    let checked = 0;
    for (const { code, map } of outputs[name]) {
      const sourceMap = new SourceMap(map);
      const generated = code.split("\n");
      generated.forEach((line, generatedLine) => {
        for (const { 1: id, index } of line.matchAll(/\bat(?:\?\.)?\((\d+)\)/g)) {
          const { file, line: originalLine, column } = probes[Number(id)];
          const entry = sourceMap.findEntry(generatedLine, index) as any;
          checked++;
          const got = `${String(entry.originalSource).replaceAll("\\", "/").split("/").slice(-2).join("/")}:${entry.originalLine + 1}:${entry.originalColumn + 1}`;
          if (got !== `${file}:${originalLine}:${column}`)
            wrong.push(`at(${id}) of ${file}:${originalLine}:${column} is at ${got}`);
        }
      });
    }
    expect(wrong).toEqual([]);
    expect(checked).toBeGreaterThan(0);
  });
});
