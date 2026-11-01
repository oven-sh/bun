// Every way Bun reports a position in a source file, checked on one set of programs (source-positions-corpus.ts).
//
// The programs are written out once per variant, which moves their text without changing what it does. Then:
//   - `bun test --coverage` runs them: lines, functions, both reporters, the lines in the JUnit report, inline snapshots
//   - `bun` runs them, then runs each bundle `Bun.build` made of them: stack traces, call sites, error previews
//   - the source maps of the bundles are read directly: every word they map has to be the same word in the source
//   - a compiled executable runs them
//   - `Bun.build` says where the programs that do not build are wrong
import { afterAll, describe, expect, test } from "bun:test";
import { bunEnv, bunExe, isWindows, tempDir } from "harness";
import { mkfifo } from "mkfifo";
import { readFileSync, rmSync } from "node:fs";
import { SourceMap } from "node:module";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { broken, cases, snapshots } from "./source-positions-corpus";

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

type Probe = { id: number; file: string; line: number; column: number; text: string };
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

    const wanted: { id: number; text: string }[] = [];
    const source = (texts.join(eol) + (finalNewline ? eol : "")).replace(
      /\b(at|ran)(\?\.)?\(\)|\bcaught\(e, "([^"]+)"\)/g,
      (_, name, optional = "", thrownAt) => {
        const id = probes.length + wanted.length;
        wanted.push({ id, text: thrownAt ?? `${name}${optional}(${id})` });
        return thrownAt ? `caught(${id}, e)` : `${name}${optional}(${id})`;
      },
    );
    for (const { id, text } of wanted) {
      const index = source.indexOf(text);
      const lineStart = source.lastIndexOf("\n", index) + 1;
      probes.push({ id, file, text, line: source.slice(0, index).split("\n").length, column: index - lineStart + 1 });
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
  // The program of a second executable, for the last group of tests. It says where a function of its own is and
  // loads the first file it is given, turns source maps on, and does both again with the second file.
  "executable/main.cjs": [
    `function bundled() {`,
    `  throw new Error("bundled");`,
    `}`,
    `function firstFrame(f) {`,
    `  try {`,
    `    f();`,
    `  } catch (e) {`,
    `    return e.stack.split("\\n")[1].trim();`,
    `  }`,
    `}`,
    `const [off, on] = process.argv.slice(2).map(file => require("node:path").resolve(file));`,
    `const out = { bundled: [firstFrame(bundled)], loaded: [firstFrame(require(off).boom)] };`,
    `process.setSourceMapsEnabled(true);`,
    `out.bundled.push(firstFrame(bundled));`,
    `out.loaded.push(firstFrame(require(on).boom));`,
    `console.log(JSON.stringify(out));`,
    ``,
  ].join("\n"),
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
const loadsFromDisk = join(root, isWindows ? "loads-from-disk.exe" : "loads-from-disk");
const [table, { logs: diagnostics }] = await Promise.all([
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
  run("run", [bunExe(), "--preload=./probe.cjs", "run.ts"]),
  ...Object.keys(builds).map(bundle),
  Bun.build({ entrypoints: [join(root, "compiled.ts")], compile: { outfile: compiled }, sourcemap: "inline" }).then(
    () => run("compiled", [compiled]),
  ),
  Bun.build({
    entrypoints: [join(root, "executable", "main.cjs")],
    compile: { outfile: loadsFromDisk },
    sourcemap: "inline",
  }),
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
    for (const { id, file, line, column, text } of probes) {
      if (!file.startsWith(variantName + "/")) continue;
      const said = lanes[laneName][id];
      if (!said?.stack) continue;
      checked++;
      const expected = `${file}:${line}:${column}`;
      const frames = said.stack.split("\n").slice(1).map(position);
      const frame = frames.findIndex(frame => frame.startsWith(file + ":"));
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

// A file that something other than Bun transpiled, with a `sourceMappingURL` comment that names its own source map.
// Bun's own map goes from what runs to that file. With `--enable-source-maps`, `process.setSourceMapsEnabled(true)`
// or `module.setSourceMapsSupport(true)`, `Error.stack` and a printed error go on to the file it was made from, as in
// Node.js. Every reader that is about the loaded file does not.
describe.concurrent("a loaded file with its own source map", () => {
  const original = [
    `type Erased = { x: number };`,
    ``,
    `export function boom(): never {`,
    `  throw new Error("kaboom");`,
    `}`,
    ``,
    `export function call<R>(cb: () => R): R[] {`,
    `  return [cb()];`,
    `}`,
    ``,
  ].join("\n");
  // What `tsc --sourceMap` (6.0.2) makes of `original`, with `--module commonjs` and with `--module esnext`.
  const transpiled = {
    cjs: {
      code: [
        `"use strict";`,
        `Object.defineProperty(exports, "__esModule", { value: true });`,
        `exports.boom = boom;`,
        `exports.call = call;`,
        `function boom() {`,
        `    throw new Error("kaboom");`,
        `}`,
        `function call(cb) {`,
        `    return [cb()];`,
        `}`,
        ``,
      ].join("\n"),
      mappings:
        ";;AAEA,oBAEC;AAED,oBAEC;AAND,SAAgB,IAAI;IAClB,MAAM,IAAI,KAAK,CAAC,QAAQ,CAAC,CAAC;AAC5B,CAAC;AAED,SAAgB,IAAI,CAAI,EAAW;IACjC,OAAO,CAAC,EAAE,EAAE,CAAC,CAAC;AAChB,CAAC",
      // Where `Error` of `new Error("kaboom")` and `cb` of `cb()` are.
      boom: "6:15",
      call: "9:13",
    },
    esm: {
      code: [
        `export function boom() {`,
        `    throw new Error("kaboom");`,
        `}`,
        `export function call(cb) {`,
        `    return [cb()];`,
        `}`,
        ``,
      ].join("\n"),
      mappings:
        "AAEA,MAAM,UAAU,IAAI;IAClB,MAAM,IAAI,KAAK,CAAC,QAAQ,CAAC,CAAC;AAC5B,CAAC;AAED,MAAM,UAAU,IAAI,CAAI,EAAW;IACjC,OAAO,CAAC,EAAE,EAAE,CAAC,CAAC;AAChB,CAAC",
      boom: "2:15",
      call: "5:13",
    },
  };
  // The same two places in `original`.
  const inOriginal = { boom: "4:13", call: "8:11" };

  type Format = keyof typeof transpiled;
  const mapOf = (format: Format, source: string, more: object = {}) =>
    JSON.stringify({
      version: 3,
      sourceRoot: "",
      sources: [source],
      names: [],
      mappings: transpiled[format].mappings,
      ...more,
    });
  const dataUrl = (json: string, type = "application/json;base64") =>
    `data:${type},${Buffer.from(json).toString("base64")}`;
  /** `path` and `path.map`, which names `source`. `after` goes between the code and the comment. */
  const withMap = (path: string, format: Format = "cjs", source = path.replace(/\.\w+$/, ".ts"), after = "") => ({
    [path]: `${transpiled[format].code}${after}//# sourceMappingURL=${path.split("/").at(-1)}.map\n`,
    [`${path}.map`]: mapOf(format, source.split("/").at(-1)!),
  });
  const withUrl = (path: string, url: string, format: Format = "cjs") => ({
    [path]: `${transpiled[format].code}//# sourceMappingURL=${url}\n`,
  });

  // What the programs below print, with the folder of the test taken out.
  const firstFrame = `
    globalThis.firstFrame = function (f) {
      try {
        f();
      } catch (e) {
        return e.stack.split("\\n")[1].trim();
      }
    };
  `;
  async function run(
    cwd: string,
    args: string[],
    env: Record<string, string | undefined> = bunEnv,
    executable = bunExe(),
  ) {
    await using proc = Bun.spawn({ cmd: [executable, ...args], cwd, env, stdout: "pipe", stderr: "pipe" });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    // A path of Windows has "\", which JSON writes twice.
    const tidy = (text: string) =>
      text.replaceAll("\\\\", "/").replaceAll("\\", "/").replaceAll(cwd.replaceAll("\\", "/"), "<dir>");
    return { stdout: tidy(stdout), stderr: tidy(stderr), exitCode };
  }
  const printed = (result: { stdout: string; stderr: string; exitCode: number }) => ({
    ...result,
    stdout: result.stdout && JSON.parse(result.stdout),
  });

  // Each line is what node v26.13.0 does, with the position that JavaScriptCore reports. It keeps the URL of a
  // module's map when the module loads, if source maps are on then. It reads the map when a stack first needs it, if
  // they are on then (nodejs/node#65490: before v26.9.0 it read the map when the module loaded).
  test("Error.stack follows the switch as it is when the module loads and when the stack is read", async () => {
    const names = ["a", "b", "c", "d", "e", "f", "g", "h", "i"];
    using dir = tempDir("own-source-map-switch", {
      ...Object.assign({}, ...names.map(name => withMap(`${name}.js`))),
      "main.cjs": `
        ${firstFrame}
        const fs = require("node:fs");
        const on = () => process.setSourceMapsEnabled(true);
        const off = () => process.setSourceMapsEnabled(false);
        const caught = f => { try { f(); } catch (e) { return e; } };
        const top = e => e.stack.split("\\n")[1].trim();
        const out = {};

        on(); out["enable, load"] = firstFrame(require("./a.js").boom); off();

        const b = require("./b.js"); on(); out["load, enable"] = firstFrame(b.boom); off();

        on(); const c = require("./c.js"); off(); out["enable, load, disable"] = firstFrame(c.boom);
        on(); out["enable, load, disable, enable"] = firstFrame(c.boom); off();

        on(); const d = require("./d.js"); fs.rmSync("./d.js.map");
        out["enable, load, delete the map"] = firstFrame(d.boom); off();

        const map = fs.readFileSync("./e.js.map", "utf8"); fs.rmSync("./e.js.map");
        on(); const e = require("./e.js"); fs.writeFileSync("./e.js.map", map);
        out["enable, load, create the map"] = firstFrame(e.boom); off();

        on(); const f = require("./f.js"); fs.writeFileSync("./f.js.map", "not a source map");
        out["enable, load, overwrite the map"] = firstFrame(f.boom); off();

        on(); const g = require("./g.js"); const madeOn = caught(g.boom); off();
        out["error made while on, stack first read while off"] = top(madeOn);
        on(); out["the same stack read again while on"] = top(madeOn); off();

        on(); const h = require("./h.js"); off(); const madeOff = caught(h.boom); on();
        out["error made while off, stack first read while on"] = top(madeOff); off();

        const before = require("./i.js"); on(); delete require.cache[require.resolve("./i.js")];
        const again = require("./i.js");
        out["load, enable, load again"] = [firstFrame(before.boom), firstFrame(again.boom)]; off();

        console.log(JSON.stringify(out));
      `,
    });
    const loaded = (name: string) => `at boom (<dir>/${name}.js:${transpiled.cjs.boom})`;
    const mapped = (name: string) => `at boom (<dir>/${name}.ts:${inOriginal.boom})`;
    expect(printed(await run(String(dir), ["main.cjs"]))).toEqual({
      stdout: {
        "enable, load": mapped("a"),
        "load, enable": loaded("b"),
        "enable, load, disable": loaded("c"),
        "enable, load, disable, enable": mapped("c"),
        "enable, load, delete the map": loaded("d"),
        "enable, load, create the map": mapped("e"),
        "enable, load, overwrite the map": loaded("f"),
        "error made while on, stack first read while off": loaded("g"),
        "the same stack read again while on": loaded("g"),
        "error made while off, stack first read while on": mapped("h"),
        "load, enable, load again": [mapped("i"), mapped("i")],
      },
      stderr: "",
      exitCode: 0,
    });
  });

  /** The lines that an error is printed under, when it is at `line:column` of `text`. */
  function preview(text: string, position: string) {
    const [line, column] = position.split(":").map(Number);
    const lines = text.split("\n").slice(Math.max(0, line - 6), line);
    const gutter = String(line).length;
    return [
      ...lines.map((text, i) => `${String(line - lines.length + 1 + i).padStart(gutter)} | ${text}`),
      " ".repeat(gutter + " | ".length + column - 1) + "^",
    ].join("\n");
  }

  // The entry point is the transpiled file, and the error leaves it. `entry.js` is CommonJS, `entry.mjs` a module.
  describe.each(["cjs", "esm"] as const)("an error that nothing catches, thrown by a %s entry point", format => {
    const entry = format === "cjs" ? "entry.js" : "entry.mjs";
    const code = transpiled[format].code + "boom();\n";
    const external = {
      [entry]: `${code}//# sourceMappingURL=${entry}.map\n`,
      [`${entry}.map`]: mapOf(format, "entry.ts"),
    };
    const printedError = async (files: Record<string, string>, flags: string[]) => {
      using dir = tempDir("own-source-map-uncaught", files);
      const { stdout, stderr, exitCode } = await run(String(dir), [...flags, entry]);
      // The preview, the message and the frame of `boom`.
      return { stdout, stderr: stderr.split("\n").slice(0, stderr.split("\n").indexOf("error: kaboom") + 2), exitCode };
    };
    const atLoaded = [
      ...preview(code, transpiled[format].boom).split("\n"),
      "error: kaboom",
      `      at boom (<dir>/${entry}:${transpiled[format].boom})`,
    ];
    const atOriginal = [
      ...preview(original, inOriginal.boom).split("\n"),
      "error: kaboom",
      `      at boom (<dir>/entry.ts:${inOriginal.boom})`,
    ];

    test("is in the original file with --enable-source-maps, and in the loaded file without it", async () => {
      const files = { ...external, "entry.ts": original };
      expect(await Promise.all([printedError(files, ["--enable-source-maps"]), printedError(files, [])])).toEqual([
        { stdout: "", stderr: atOriginal, exitCode: 1 },
        { stdout: "", stderr: atLoaded, exitCode: 1 },
      ]);
    });

    test("is previewed from the sourcesContent of a data: URL", async () => {
      const inline = dataUrl(mapOf(format, "entry.ts", { sourcesContent: [original] }));
      expect(
        await printedError({ [entry]: `${code}//# sourceMappingURL=${inline}\n` }, ["--enable-source-maps"]),
      ).toEqual({ stdout: "", stderr: atOriginal, exitCode: 1 });
    });

    // Node.js prints the line of the loaded file then, under the name of the loaded file.
    test("has no source lines when nothing has the original text", async () => {
      expect(await printedError(external, ["--enable-source-maps"])).toEqual({
        stdout: "",
        stderr: atOriginal.slice(-2),
        exitCode: 1,
      });
    });
  });

  test("require(), import, import() and a Worker's import read it with --enable-source-maps, and not without", async () => {
    using dir = tempDir("own-source-map-loaders", {
      ...withMap("required.cjs", "cjs"),
      ...withMap("static.mjs", "esm"),
      ...withMap("dynamic.mjs", "esm"),
      ...withMap("in-worker.mjs", "esm"),
      "worker.mjs": `
        import { parentPort } from "node:worker_threads";
        import { boom } from "./in-worker.mjs";
        try {
          boom();
        } catch (e) {
          parentPort.postMessage(e.stack.split("\\n")[1].trim());
        }
      `,
      "main.mjs": `
        import { createRequire } from "node:module";
        import { Worker } from "node:worker_threads";
        import { boom } from "./static.mjs";
        ${firstFrame}
        const out = {
          "require()": firstFrame(createRequire(import.meta.url)("./required.cjs").boom),
          "import": firstFrame(boom),
          "import()": firstFrame((await import("./dynamic.mjs")).boom),
        };
        const { promise, resolve, reject } = Promise.withResolvers();
        const worker = new Worker(new URL("./worker.mjs", import.meta.url));
        worker.on("message", resolve);
        worker.on("error", reject);
        worker.on("exit", code => reject(new Error("the worker exited with " + code)));
        out["import in a Worker"] = await promise;
        await worker.terminate();
        console.log(JSON.stringify(out));
      `,
    });
    const frames = (frame: (file: string, format: Format) => string) => ({
      stdout: {
        "require()": frame("required.cjs", "cjs"),
        "import": frame("static.mjs", "esm"),
        "import()": frame("dynamic.mjs", "esm"),
        "import in a Worker": frame("in-worker.mjs", "esm"),
      },
      stderr: "",
      exitCode: 0,
    });
    const [withTheFlag, without] = await Promise.all([
      run(String(dir), ["--enable-source-maps", "main.mjs"]),
      run(String(dir), ["main.mjs"]),
    ]);
    expect([printed(withTheFlag), printed(without)]).toEqual([
      frames(file => `at boom (<dir>/${file.replace(/\.\w+$/, ".ts")}:${inOriginal.boom})`),
      frames((file, format) => `at boom (<dir>/${file}:${transpiled[format].boom})`),
    ]);
  });

  // While a debugger listens, Bun puts a source map of its own at the end of each module that loads, for the
  // debugger, and the mappings of the module go to the table from the code that does that. stderr is not compared:
  // the inspector says there where it listens, when it starts before the program ends.
  test("with --inspect, require() reads it with --enable-source-maps, and not without", async () => {
    using dir = tempDir("own-source-map-inspector", {
      ...withMap("lib.js"),
      "main.cjs": `
        ${firstFrame}
        console.log(firstFrame(require("./lib.js").boom));
      `,
    });
    const [withTheFlag, without] = await Promise.all([
      run(String(dir), ["--inspect=127.0.0.1:0", "--enable-source-maps", "main.cjs"]),
      run(String(dir), ["--inspect=127.0.0.1:0", "main.cjs"]),
    ]);
    expect([withTheFlag, without].map(({ stdout, exitCode }) => ({ stdout, exitCode }))).toEqual([
      { stdout: `at boom (<dir>/lib.ts:${inOriginal.boom})\n`, exitCode: 0 },
      { stdout: `at boom (<dir>/lib.js:${transpiled.cjs.boom})\n`, exitCode: 0 },
    ]);
  });

  // What is bundled into an executable is not a file that it loads, and the switch changes nothing for it: a frame is
  // where the executable's own source map puts it. A file that the executable loads from disk is a loaded file.
  test("an executable reads it for a file that it loads from disk, and what is bundled stays where it is", async () => {
    using dir = tempDir("own-source-map-executable", { ...withMap("off.js"), ...withMap("on.js") });
    const result = printed(await run(String(dir), ["off.js", "on.js"], bunEnv, loadsFromDisk));
    // The path in a frame of the executable is relative to where the executable was built.
    if (result.stdout) result.stdout.bundled = result.stdout.bundled.map(position);
    expect(result).toEqual({
      // Each is [while source maps are off, after they are turned on].
      stdout: {
        // `Error` of `new Error("bundled")`.
        bundled: ["executable/main.cjs:2:13", "executable/main.cjs:2:13"],
        loaded: [`at boom (<dir>/off.js:${transpiled.cjs.boom})`, `at boom (<dir>/on.ts:${inOriginal.boom})`],
      },
      stderr: "",
      exitCode: 0,
    });
  });

  // node v26.13.0: `/[\\/]node_modules[\\/]/` on the path, when the module loads and again when a stack is read.
  test("a module in node_modules is left out unless nodeModules is set", async () => {
    using dir = tempDir("own-source-map-node-modules", {
      ...withMap("node_modules/dep/a.js"),
      ...withMap("node_modules/dep/b.js"),
      ...withMap("node_modules/dep/c.js"),
      ...withMap("node_modules/.store/dep@1/node_modules/dep/d.js"),
      ...withMap("my_node_modules/dep/e.js"),
      ...withMap("node_modules_too/dep/f.js"),
      "main.cjs": `
        ${firstFrame}
        const { setSourceMapsSupport } = require("node:module");
        const out = {};
        setSourceMapsSupport(true);
        out["setSourceMapsSupport(true)"] = firstFrame(require("./node_modules/dep/a.js").boom);
        out["in my_node_modules"] = firstFrame(require("./my_node_modules/dep/e.js").boom);
        out["in node_modules_too"] = firstFrame(require("./node_modules_too/dep/f.js").boom);
        setSourceMapsSupport(true, { nodeModules: true });
        out["loaded before nodeModules was set"] = firstFrame(require("./node_modules/dep/a.js").boom);
        out["setSourceMapsSupport(true, { nodeModules: true })"] = firstFrame(require("./node_modules/dep/b.js").boom);
        out["in a store in node_modules"] = firstFrame(
          require("./node_modules/.store/dep@1/node_modules/dep/d.js").boom,
        );
        setSourceMapsSupport(true);
        out["read after nodeModules was unset"] = firstFrame(require("./node_modules/dep/b.js").boom);
        setSourceMapsSupport(false);
        process.setSourceMapsEnabled(true);
        out["process.setSourceMapsEnabled(true)"] = firstFrame(require("./node_modules/dep/c.js").boom);
        console.log(JSON.stringify(out));
      `,
    });
    const loaded = (file: string) => `at boom (<dir>/${file}.js:${transpiled.cjs.boom})`;
    const mapped = (file: string) => `at boom (<dir>/${file}.ts:${inOriginal.boom})`;
    expect(printed(await run(String(dir), ["main.cjs"]))).toEqual({
      stdout: {
        "setSourceMapsSupport(true)": loaded("node_modules/dep/a"),
        "in my_node_modules": mapped("my_node_modules/dep/e"),
        "in node_modules_too": mapped("node_modules_too/dep/f"),
        "loaded before nodeModules was set": loaded("node_modules/dep/a"),
        "setSourceMapsSupport(true, { nodeModules: true })": mapped("node_modules/dep/b"),
        "in a store in node_modules": mapped("node_modules/.store/dep@1/node_modules/dep/d"),
        "read after nodeModules was unset": loaded("node_modules/dep/b"),
        "process.setSourceMapsEnabled(true)": mapped("node_modules/dep/c"),
      },
      stderr: "",
      exitCode: 0,
    });
  });

  // What is about the loaded file stays there. In node v26.13.0 a CallSite answers for the loaded file too, and
  // `error.stack` inside `Error.prepareStackTrace` is the loaded file's.
  test("a CallSite is in the loaded file while Error.stack is in the original", async () => {
    using dir = tempDir("own-source-map-call-site", {
      ...withMap("lib.js"),
      "main.cjs": `
        const lib = require("./lib.js");
        const out = {};
        const error = new Error("made in the original");
        lib.call(() => Error.captureStackTrace(error));
        out["Error.stack"] = error.stack.split("\\n")[2].trim();
        Error.prepareStackTrace = (e, sites) => {
          const site = sites[1];
          out["CallSite"] = {
            getFileName: site.getFileName(),
            getScriptNameOrSourceURL: site.getScriptNameOrSourceURL(),
            getLineNumber: site.getLineNumber(),
            getColumnNumber: site.getColumnNumber(),
            toString: String(site),
          };
          out["error.stack in prepareStackTrace"] = e.stack.split("\\n")[2].trim();
          return "prepared";
        };
        out["the result of prepareStackTrace"] = lib.call(() => new Error("read by a callback").stack)[0];
        console.log(JSON.stringify(out));
      `,
    });
    const [line, column] = transpiled.cjs.call.split(":").map(Number);
    expect(printed(await run(String(dir), ["--enable-source-maps", "main.cjs"]))).toEqual({
      stdout: {
        "Error.stack": `at call (<dir>/lib.ts:${inOriginal.call})`,
        "CallSite": {
          getFileName: "<dir>/lib.js",
          getScriptNameOrSourceURL: "<dir>/lib.js",
          getLineNumber: line,
          getColumnNumber: column,
          toString: `call (<dir>/lib.js:${transpiled.cjs.call})`,
        },
        "error.stack in prepareStackTrace": `at call (<dir>/lib.js:${transpiled.cjs.call})`,
        "the result of prepareStackTrace": "prepared",
      },
      stderr: "",
      exitCode: 0,
    });
  });

  /** The `mappings` of a map where line `i + 1` of the generated text is line `lines[i]` of the original. */
  function lineMappings(lines: number[]) {
    const digits = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    let previous = 1;
    return lines
      .map(line => {
        let value = line >= previous ? (line - previous) << 1 : ((previous - line) << 1) | 1;
        previous = line;
        let delta = "";
        do {
          const digit = value & 31;
          value >>>= 5;
          delta += digits[value ? digit | 32 : digit];
        } while (value);
        return `AA${delta}A`;
      })
      .join(";");
  }

  test("bun test writes coverage, an inline snapshot and the JUnit line for the loaded file", async () => {
    const testFile = [
      `const { test, expect } = require("bun:test");`,
      `const { add } = require("./math.js");`,
      `test("adds", () => {`,
      `  expect(add(1, 2)).toMatchInlineSnapshot();`,
      `  console.log(new Error("in the test").stack.split("\\n")[1].trim());`,
      `});`,
      `//# sourceMappingURL=math.test.js.map`,
      ``,
    ];
    const math = [
      `function add(a, b) {`,
      `  if (a > 100) {`,
      `    return -1;`,
      `  }`,
      `  return a + b;`,
      `}`,
      `exports.add = add;`,
      `//# sourceMappingURL=math.js.map`,
      ``,
    ];
    // Each original has four more lines above its code.
    const shifted = (lines: string[], source: string) =>
      JSON.stringify({
        version: 3,
        sources: [source],
        names: [],
        mappings: lineMappings(lines.slice(0, -2).map((_, i) => i + 5)),
      });
    using dir = tempDir("own-source-map-bun-test", {
      "math.test.js": testFile.join("\n"),
      "math.test.js.map": shifted(testFile, "math.test.ts"),
      "math.js": math.join("\n"),
      "math.js.map": shifted(math, "math.ts"),
    });
    const { stdout, exitCode } = await run(String(dir), [
      "test",
      "--enable-source-maps",
      "--coverage",
      "--coverage-reporter=lcov",
      "--reporter=junit",
      "--reporter-outfile=junit.xml",
      "--update-snapshots",
      "./math.test.js",
    ]);
    const lcov = readFileSync(join(String(dir), "coverage", "lcov.info"), "utf8");
    expect({
      // `Error.stack` is mapped. An inline snapshot is written into the file that ran. Coverage and the JUnit line
      // are about that file too, which is a choice of Bun: the test runner of Node.js maps both with the flag.
      stack: stdout.split("\n").filter(line => line.startsWith("at ")),
      covered: lcov
        .split("end_of_record\n")[0]
        .split("\n")
        .filter(line => /^(SF|DA):/.test(line)),
      snapshot: readFileSync(join(String(dir), "math.test.js"), "utf8").split("\n")[3],
      junit: readFileSync(join(String(dir), "junit.xml"), "utf8").match(/<testcase name="adds"[^>]* line="(\d+)"/)?.[1],
      exitCode,
    }).toEqual({
      stack: ["at <anonymous> (<dir>/math.test.ts:9:1)"],
      covered: ["SF:math.js", "DA:1,1", "DA:2,1", "DA:3,0", "DA:5,1", "DA:7,1"],
      snapshot: "  expect(add(1, 2)).toMatchInlineSnapshot(`3`);",
      junit: "3",
      exitCode: 0,
    });
  });

  // A profile is of the code that ran. `spin` runs for 100 ms, which is long enough to be sampled on every platform.
  test("--cpu-prof says where a function is in the loaded file", async () => {
    const lib = [
      `exports.spin = function spin(ms) {`,
      `  const end = performance.now() + ms;`,
      `  while (performance.now() < end) {}`,
      `  return new Error("spun").stack.split("\\n")[1].trim();`,
      `};`,
      `//# sourceMappingURL=lib.js.map`,
      ``,
    ];
    using dir = tempDir("own-source-map-cpu-profile", {
      "lib.js": lib.join("\n"),
      // Each line is ten lines further down in `lib.ts`.
      "lib.js.map": JSON.stringify({
        version: 3,
        sources: ["lib.ts"],
        names: [],
        mappings: lineMappings(lib.slice(0, -2).map((_, i) => i + 11)),
      }),
      "main.cjs": `console.log(JSON.stringify(require("./lib.js").spin(100)));`,
    });
    const result = await run(String(dir), [
      "--enable-source-maps",
      "--cpu-prof",
      "--cpu-prof-name=profile.cpuprofile",
      "main.cjs",
    ]);
    expect(printed(result)).toEqual({ stdout: "at spin (<dir>/lib.ts:14:1)", stderr: "", exitCode: 0 });
    const { nodes } = JSON.parse(readFileSync(join(String(dir), "profile.cpuprofile"), "utf8"));
    const spin: { url: string; lineNumber: number }[] = nodes
      .map((node: any) => node.callFrame)
      .filter((callFrame: any) => callFrame.functionName === "spin");
    // The file and the line, which is from 0, of each node that is of `spin`.
    expect([...new Set(spin.map(({ url, lineNumber }) => `${url.split("/").at(-1)}:${lineNumber}`))]).toEqual([
      "lib.js:0",
    ]);
  });

  // The parser says where the text that it was given is wrong. No map is asked. node v26.13.0 names the loaded file
  // too. `bad.js` is what Bun's parser refuses, and `bad-regexp.js` what only JavaScriptCore refuses.
  test("where a module that does not parse is wrong is a place in the loaded file", async () => {
    const map = (source: string) =>
      JSON.stringify({ version: 3, sources: [source], names: [], mappings: lineMappings([11, 12]) });
    using dir = tempDir("own-source-map-syntax-error", {
      "bad.js": `function (\n//# sourceMappingURL=bad.js.map\n`,
      "bad.js.map": map("bad.ts"),
      "bad-regexp.js": `const a = 1;\nconst re = /(/;\n//# sourceMappingURL=bad-regexp.js.map\n`,
      "bad-regexp.js.map": map("bad-regexp.ts"),
      "main.cjs": `
        try {
          require("./bad-regexp.js");
        } catch (error) {
          const { name, line, sourceURL, stack } = error;
          console.log(JSON.stringify({ name, line, sourceURL, frame: stack.split("\\n")[1].trim() }));
        }
      `,
    });
    const [refused, caught, caughtWithout] = await Promise.all([
      run(String(dir), ["--enable-source-maps", "bad.js"]),
      run(String(dir), ["--enable-source-maps", "main.cjs"]),
      run(String(dir), ["main.cjs"]),
    ]);
    // The lines that say where: one for each of the two things that the parser finds wrong.
    expect({ ...refused, stderr: refused.stderr.split("\n").filter(line => /^\s+at /.test(line)) }).toEqual({
      stdout: "",
      stderr: ["    at <dir>/bad.js:1:10", "    at <dir>/bad.js:2:32"],
      exitCode: 1,
    });
    const inTheLoadedFile = {
      stdout: {
        name: "SyntaxError",
        line: 2,
        sourceURL: "<dir>/bad-regexp.js",
        frame: "at <parse> (<dir>/bad-regexp.js:2)",
      },
      stderr: "",
      exitCode: 0,
    };
    expect([printed(caught), printed(caughtWithout)]).toEqual([inTheLoadedFile, inTheLoadedFile]);
  });

  // Node.js says nothing either. It reads an index map that has `sources` beside its `sections`. Bun reads no
  // index map.
  test("a source map that cannot be read or used leaves the stack in the loaded file, without a warning", async () => {
    const unusable: Record<string, Record<string, string | object>> = {
      "not JSON": { "not-json.js.map": "{ not JSON" },
      "an empty file": { "empty.js.map": "" },
      "a missing file": {},
      "a directory": { "directory.js.map": {} },
      "a JSON array": { "array.js.map": "[]" },
      "no mappings": { "no-mappings.js.map": JSON.stringify({ version: 3, sources: ["a.ts"] }) },
      "no sources": { "no-sources.js.map": JSON.stringify({ version: 3, mappings: transpiled.cjs.mappings }) },
      "mappings that are no VLQ": { "not-vlq.js.map": mapOf("cjs", "a.ts", { mappings: ";;;;;!!!!" }) },
      "an index map": {
        "index-map.js.map": JSON.stringify({
          version: 3,
          sections: [{ offset: { line: 0, column: 0 }, map: JSON.parse(mapOf("cjs", "a.ts")) }],
        }),
      },
    };
    const name = (label: string) => Object.keys(unusable[label])[0]?.replace(".map", "") ?? "missing.js";
    using dir = tempDir("own-source-map-unusable", {
      ...withMap("usable.js"),
      ...Object.assign({}, ...Object.keys(unusable).map(label => ({ ...withMap(name(label)), ...unusable[label] }))),
      ...withUrl("bad-base64.js", "data:application/json;base64,!!!!"),
      ...withUrl("empty-url.js", ""),
      "main.cjs": `
        ${firstFrame}
        const out = {};
        for (const [label, file] of ${JSON.stringify([
          ["a source map", "usable.js"],
          ...Object.keys(unusable).map(label => [label, name(label)]),
          ["a data: URL that is not base64", "bad-base64.js"],
          ["an empty URL", "empty-url.js"],
        ])}) out[label] = firstFrame(require("./" + file).boom);
        console.log(JSON.stringify(out));
      `,
    });
    rmSync(join(String(dir), "missing.js.map"));
    const loaded = (file: string) => `at boom (<dir>/${file}:${transpiled.cjs.boom})`;
    expect(printed(await run(String(dir), ["--enable-source-maps", "main.cjs"]))).toEqual({
      stdout: {
        "a source map": `at boom (<dir>/usable.ts:${inOriginal.boom})`,
        ...Object.fromEntries(Object.keys(unusable).map(label => [label, loaded(name(label))])),
        "a data: URL that is not base64": loaded("bad-base64.js"),
        "an empty URL": loaded("empty-url.js"),
      },
      stderr: "",
      exitCode: 0,
    });
  });

  // Opening a FIFO to read it waits for a writer, and this one has none: a load that waited for one would never end.
  test.skipIf(isWindows)("a FIFO in place of the source map is not read, and the module loads", async () => {
    using dir = tempDir("own-source-map-fifo", {
      ...withMap("usable.js"),
      ...withUrl("fifo.js", "fifo.js.map"),
      "main.cjs": `
        ${firstFrame}
        console.log(JSON.stringify(["usable.js", "fifo.js"].map(file => firstFrame(require("./" + file).boom))));
      `,
    });
    mkfifo(join(String(dir), "fifo.js.map"));
    const loaded = (file: string) => `at boom (<dir>/${file}:${transpiled.cjs.boom})`;
    const [withTheFlag, without] = await Promise.all([
      run(String(dir), ["--enable-source-maps", "main.cjs"]),
      run(String(dir), ["main.cjs"]),
    ]);
    expect([printed(withTheFlag), printed(without)]).toEqual([
      { stdout: [`at boom (<dir>/usable.ts:${inOriginal.boom})`, loaded("fifo.js")], stderr: "", exitCode: 0 },
      { stdout: [loaded("usable.js"), loaded("fifo.js")], stderr: "", exitCode: 0 },
    ]);
  });

  // `main.cjs` writes `lib.js` and its source map anew once, and `--hot` then loads both files again.
  test("--hot reads the source map again when it loads the file again", async () => {
    const changed = withMap("lib.js", "cjs", "second.ts", "exports.changed = true;\n");
    using dir = tempDir("own-source-map-hot", {
      ...withMap("lib.js", "cjs", "first.ts"),
      "main.cjs": `
        ${firstFrame}
        const fs = require("node:fs");
        globalThis.loads = (globalThis.loads ?? 0) + 1;
        const { boom } = require("./lib.js");
        // --hot can load lib.js while it is empty, between the two steps of the write below. It then loads it again.
        if (boom) {
          console.log(firstFrame(boom));
          if (globalThis.loads > 1) process.exit(0);
          fs.writeFileSync("./lib.js.map", ${JSON.stringify(changed["lib.js.map"])});
          fs.writeFileSync("./lib.js", ${JSON.stringify(changed["lib.js"])});
        }
      `,
    });
    const { stdout, stderr, exitCode } = await run(String(dir), ["--hot", "--enable-source-maps", "main.cjs"]);
    expect({
      stdout: stdout.split("\n"),
      // A debug build says when it loads again.
      stderr: stderr.split("\n").filter(line => line && !line.startsWith("DEBUG: ")),
      exitCode,
    }).toEqual({
      stdout: [`at boom (<dir>/first.ts:${inOriginal.boom})`, `at boom (<dir>/second.ts:${inOriginal.boom})`, ""],
      stderr: [],
      exitCode: 0,
    });
  });

  // What node v26.13.0 reads: a `data:` URL that says `application/json` and ends its parameters with `base64`, and a
  // path, which is a URL relative to the module. It does not read a URL with any other scheme. The comment is a `//`
  // comment that starts with `//# sourceMappingURL=` or `//@ sourceMappingURL=`, and only white space is after the
  // URL on its line. The last such comment of the file counts, also when it has no URL to read.
  test("the URL of the comment is read the way Node.js reads it", async () => {
    const map = mapOf("cjs", "original.ts");
    const comment = (url: string) => `//# sourceMappingURL=${url}\n`;
    const { code } = transpiled.cjs;
    // [what the module ends with, the files beside it, where the frame is]
    const forms: Record<string, [string | ((root: string) => string), Record<string, string>, string]> = {
      "a file beside the module": [comment("a.js.map"), { "a.js.map": map }, "original.ts"],
      "./": [comment("./b.js.map"), { "b.js.map": map }, "original.ts"],
      // A relative source is beside the map.
      "a file in a folder": [comment("maps/c.js.map"), { "maps/c.js.map": map }, "maps/original.ts"],
      "..": [comment("../forms/d.js.map"), { "d.js.map": map }, "original.ts"],
      "a percent-encoded name": [comment("sp%20ace.js.map"), { "sp ace.js.map": map }, "original.ts"],
      "a query and a fragment": [comment("e.js.map?v=1#top"), { "e.js.map": map }, "original.ts"],
      "a name that is not ASCII": [comment("ünï.js.map"), { "ünï.js.map": map }, "original.ts"],
      "//@": [`//@ sourceMappingURL=f.js.map\n`, { "f.js.map": map }, "original.ts"],
      "spaces after the URL": [`//# sourceMappingURL=g.js.map  \n`, { "g.js.map": map }, "original.ts"],
      "no line break after the URL": [`//# sourceMappingURL=h.js.map`, { "h.js.map": map }, "original.ts"],
      "CR LF after the URL": [`//# sourceMappingURL=i.js.map\r\n`, { "i.js.map": map }, "original.ts"],
      "the last of two comments": [comment("none.js.map") + comment("j.js.map"), { "j.js.map": map }, "original.ts"],
      "the last of two comments, which names nothing": [
        comment("k.js.map") + comment("none.js.map"),
        { "k.js.map": map },
        "",
      ],
      "the last of two comments, which text follows": [
        comment("r.js.map") + `//# sourceMappingURL=s.js.map and more\n`,
        { "r.js.map": map, "s.js.map": map },
        "",
      ],
      "a comment, then a block comment with one in it": [
        comment("t.js.map") + `/* //# sourceMappingURL=none.js.map */\n`,
        { "t.js.map": map },
        "original.ts",
      ],
      "a comment that more code follows": [
        comment("l.js.map") + `exports.after = 1;\n`,
        { "l.js.map": map },
        "original.ts",
      ],
      "a string": [`exports.text = "//# sourceMappingURL=m.js.map";\n`, { "m.js.map": map }, ""],
      "/*#": [`/*# sourceMappingURL=u.js.map */\n`, { "u.js.map": map }, ""],
      "/*@": [`/*@ sourceMappingURL=v.js.map */\n`, { "v.js.map": map }, ""],
      "a space before the #": [`// # sourceMappingURL=w.js.map\n`, { "w.js.map": map }, ""],
      "no space after the #": [`//#sourceMappingURL=x.js.map\n`, { "x.js.map": map }, ""],
      "two spaces after the #": [`//#  sourceMappingURL=y.js.map\n`, { "y.js.map": map }, ""],
      "text before the //#": [`// see //# sourceMappingURL=z.js.map\n`, { "z.js.map": map }, ""],
      "text after the URL": [`//# sourceMappingURL=aa.js.map and more\n`, { "aa.js.map": map }, ""],
      // A quote is a character of the URL like any other.
      "quotes around the URL": [`//# sourceMappingURL="ab.js.map"\n`, { "ab.js.map": map }, ""],
      "quotes in the name of the file": [`//# sourceMappingURL='ac.js.map'\n`, { "'ac.js.map'": map }, "original.ts"],
      "the last of two comments, which has quotes around its URL": [
        comment("ad.js.map") + `//# sourceMappingURL="none.js.map"\n`,
        { "ad.js.map": map },
        "",
      ],
      // One white space character of any kind is between the marker and the name.
      "a tab after the #": [`//#\tsourceMappingURL=ae.js.map\n`, { "ae.js.map": map }, "original.ts"],
      "a no-break space after the #": [`//#\u00A0sourceMappingURL=af.js.map\n`, { "af.js.map": map }, "original.ts"],
      // White space before the URL is not a part of it.
      "a space after the =": [`//# sourceMappingURL= ag.js.map\n`, { "ag.js.map": map }, "original.ts"],
      "a tab after the =": [`//# sourceMappingURL=\tah.js.map\n`, { "ah.js.map": map }, "original.ts"],
      // A block comment names no source map, and takes none away.
      "a comment, then a block comment that starts with the marker": [
        comment("ai.js.map") + `/*# sourceMappingURL=none.js.map */\n`,
        { "ai.js.map": map },
        "original.ts",
      ],
      "a comment, then one with no URL at the end of the file": [
        comment("aj.js.map") + `//# sourceMappingURL=`,
        { "aj.js.map": map },
        "",
      ],
      "a comment, then one with a tab after the #, which names nothing": [
        comment("ak.js.map") + `//#\tsourceMappingURL=none.js.map\n`,
        { "ak.js.map": map },
        "",
      ],
      // Only white space ends the URL.
      "a control character in the URL": [
        `//# sourceMappingURL=al\u0001.js.map\n`,
        { "al\u0001.js.map": map },
        "original.ts",
      ],
      "data: with base64": [comment(dataUrl(map)), {}, "original.ts"],
      "data: with a charset before base64": [
        comment(dataUrl(map, "application/json;charset=utf-8;base64")),
        {},
        "original.ts",
      ],
      "DATA:": [comment(dataUrl(map).replace("data:", "DATA:")), {}, "original.ts"],
      "data: with base64url and no padding": [
        comment(`data:application/json;base64,${Buffer.from(map).toString("base64url")}`),
        {},
        "original.ts",
      ],
      "data: with base64 before a charset": [comment(dataUrl(map, "application/json;base64;charset=utf-8")), {}, ""],
      "data: with another media type": [comment(dataUrl(map, "text/plain;base64")), {}, ""],
      "data: with no media type": [comment(dataUrl(map, ";base64")), {}, ""],
      "data: with Application/JSON": [comment(dataUrl(map, "Application/JSON;base64")), {}, ""],
      // Node.js takes the data up to a second comma, so JSON that has one is cut.
      "data: with JSON that is not base64": [comment(`data:application/json,${map}`), {}, ""],
      "data: with percent-encoded JSON": [comment(`data:application/json,${encodeURIComponent(map)}`), {}, ""],
      "data: with no comma": [comment("data:application/json;base64"), {}, ""],
      "file:": [root => comment(`${pathToFileURL(root)}/forms/n.js.map`), { "n.js.map": map }, ""],
      "http:": [comment("http://127.0.0.1:1/o.js.map"), { "o.js.map": map }, ""],
      "https:": [comment("https://127.0.0.1:1/p.js.map"), { "p.js.map": map }, ""],
      // A path with a drive letter is a URL with a scheme.
      ...(!isWindows && {
        "an absolute path": [
          root => comment(`${root}/elsewhere/q.js.map`),
          { "../elsewhere/q.js.map": map },
          "../elsewhere/original.ts",
        ],
      }),
    };
    const files: Record<string, string | ((at: { root: string }) => string)> = {};
    const modules: [string, string][] = [];
    let count = 0;
    for (const [label, [end, beside]] of Object.entries(forms)) {
      const module = `forms/m${count++}.js`;
      modules.push([label, module]);
      files[module] = ({ root }) => code + (typeof end === "function" ? end(root) : end);
      for (const [name, text] of Object.entries(beside)) files[`forms/${name}`] = text;
    }
    using dir = tempDir("own-source-map-url", {
      ...files,
      "main.cjs": `
        ${firstFrame}
        const out = {};
        for (const [label, module] of ${JSON.stringify(modules)}) out[label] = firstFrame(require("./" + module).boom);
        console.log(JSON.stringify(out));
      `,
    });
    const want: Record<string, string> = {};
    for (const [label, module] of modules) {
      const source = forms[label][2];
      want[label] = source
        ? `at boom (<dir>/${join("forms", source).replaceAll("\\", "/")}:${inOriginal.boom})`
        : `at boom (<dir>/${module}:${transpiled.cjs.boom})`;
    }
    expect(printed(await run(String(dir), ["--enable-source-maps", "main.cjs"]))).toEqual({
      stdout: want,
      stderr: "",
      exitCode: 0,
    });
  });

  // node v26.13.0 puts `sourceRoot` before the source with nothing between them, and resolves the result as a URL
  // beside the map. A `file:` URL is shown as a path.
  test("a source is named the way Node.js names it", async () => {
    // [sourceRoot, source, the name in the frame]
    const named: [string | null | undefined, string, string][] = [
      [undefined, "original.ts", "<dir>/maps/original.ts"],
      ["", "../src/./original.ts", "<dir>/src/original.ts"],
      ["src", "original.ts", "<dir>/maps/srcoriginal.ts"],
      ["src/", "original.ts", "<dir>/maps/src/original.ts"],
      ["../", "original.ts", "<dir>/original.ts"],
      [null, "original.ts", "<dir>/maps/original.ts"],
      ["http://example.com/root/", "original.ts", "http://example.com/root/original.ts"],
      ["", "webpack://app/./src/original.ts", "webpack://app/src/original.ts"],
      ["", "webpack:///./src/original.ts?a=1", "webpack:///src/original.ts?a=1"],
      ["", "a%20b.ts", "<dir>/maps/a b.ts"],
      ["", "a b.ts", "<dir>/maps/a b.ts"],
      ["", "original.ts?query#fragment", "<dir>/maps/original.ts"],
      ["", "ünï.ts", "<dir>/maps/ünï.ts"],
      // A path from the root has a drive on Windows. Node.js keeps an absolute path as it is written: no `%20` is
      // a space, and a `?` does not end it.
      ...((isWindows
        ? []
        : [
            ["/abs/root/", "original.ts", "/abs/root/original.ts"],
            ["file:///abs/root/", "original.ts", "/abs/root/original.ts"],
            ["", "/abs/src/../original.ts", "/abs/original.ts"],
            ["", "/abs/a%20b.ts?query", "/abs/a%20b.ts?query"],
            ["", "file:///abs/src/original.ts", "/abs/src/original.ts"],
          ]) as [string, string, string][]),
    ];
    const files: Record<string, string> = {};
    named.forEach(([sourceRoot, source], i) => {
      files[`s${i}.js`] = `${transpiled.cjs.code}//# sourceMappingURL=maps/s${i}.js.map\n`;
      files[`maps/s${i}.js.map`] = mapOf("cjs", source, { sourceRoot });
    });
    using dir = tempDir("own-source-map-sources", {
      ...files,
      // The source of a `data:` URL is beside the module.
      ...withUrl("inline.js", dataUrl(mapOf("cjs", "src/original.ts"))),
      "main.cjs": `
        ${firstFrame}
        const out = [];
        for (let i = 0; i < ${named.length}; i++) out.push(firstFrame(require("./s" + i + ".js").boom));
        out.push(firstFrame(require("./inline.js").boom));
        console.log(JSON.stringify(out));
      `,
    });
    expect(printed(await run(String(dir), ["--enable-source-maps", "main.cjs"]))).toEqual({
      stdout: [...named.map(([, , name]) => name), "<dir>/src/original.ts"].map(
        name => `at boom (${name}:${inOriginal.boom})`,
      ),
      stderr: "",
      exitCode: 0,
    });
  });

  // A module that returns errors nothing has read. The functions of their stacks are garbage once `make` returns, so
  // a collection formats the stacks. The finally blocks keep every return out of tail position.
  const madeUnread = {
    "make.js": [
      `exports.make = function () {`,
      `  function thrower() { try { return new Error("made"); } finally {} }`,
      `  try { return thrower(); } finally {}`,
      `};`,
      `//# sourceMappingURL=make.js.map`,
      ``,
    ].join("\n"),
    // Line 2 of `make.js` is line 7 of `make.ts`.
    "make.js.map": JSON.stringify({
      version: 3,
      sources: ["make.ts"],
      names: [],
      mappings: lineMappings([5, 7, 8, 9]),
    }),
  };

  // The map is read by the first stack that needs it. Here that is a collection: the file is gone before any stack
  // is read, and a stack that no collection formatted would be in the loaded file.
  test("a stack that a collection formats is in the original file", async () => {
    using dir = tempDir("own-source-map-collection", {
      ...madeUnread,
      "main.cjs": `
        const { make } = require("./make.js");
        const errors = Array.from({ length: 8 }, () => make());
        setImmediate(() => {
          Bun.gc(true);
          require("node:fs").rmSync("./make.js.map");
          console.log(JSON.stringify([...new Set(errors.map(error => error.stack.split("\\n")[1].trim()))]));
        });
      `,
    });
    expect(printed(await run(String(dir), ["--enable-source-maps", "main.cjs"]))).toEqual({
      stdout: ["at thrower (<dir>/make.ts:7:1)"],
      stderr: "",
      exitCode: 0,
    });
  });

  // With an `Error.prepareStackTrace`, a read of the stack is in the loaded file: the function gets call sites. The
  // text that a collection makes for a stack nothing read stands in for that read.
  test("with an Error.prepareStackTrace, a stack that a collection formats is in the loaded file", async () => {
    using dir = tempDir("own-source-map-collection-formatter", {
      ...madeUnread,
      "main.cjs": `
        Error.prepareStackTrace = (error, sites) => "prepared: " + sites[0].getFileName() + ":" + sites[0].getLineNumber();
        const { make } = require("./make.js");
        const errors = Array.from({ length: 8 }, () => make());
        const atOnce = make().stack;
        setImmediate(() => {
          Bun.gc(true);
          const files = new Set([atOnce, ...errors.map(error => error.stack)].map(stack => stack.match(/make\\.\\w+:\\d+/)?.[0]));
          console.log(JSON.stringify([...files]));
        });
      `,
    });
    expect(printed(await run(String(dir), ["--enable-source-maps", "main.cjs"]))).toEqual({
      stdout: ["make.js:2"],
      stderr: "",
      exitCode: 0,
    });
  });

  // `--smol` collects while the loader turns the parsed `.jsonc` file into values, and that collection is the first
  // reader of the map. The parser of the map must leave the loader's syntax tree alone.
  test("a collection that reads a source map during the load of a .jsonc file leaves that file whole", async () => {
    const strings = Array.from({ length: 600 }, (_, i) => String(i).padEnd(4096, "x"));
    using dir = tempDir("own-source-map-collection-in-a-load", {
      ...madeUnread,
      "data.jsonc": `// a comment\n${JSON.stringify(strings)}`,
      "main.cjs": `
        const { make } = require("./make.js");
        const errors = Array.from({ length: 8 }, () => make());
        const data = require("./data.jsonc");
        require("node:fs").rmSync("./make.js.map");
        let wrong = 0;
        for (let i = 0; i < ${strings.length}; i++) if (data[i] !== String(i).padEnd(4096, "x")) wrong++;
        console.log(
          JSON.stringify({
            length: data.length,
            wrong,
            frames: [...new Set(errors.map(error => error.stack.split("\\n")[1].trim()))],
          }),
        );
      `,
    });
    expect(printed(await run(String(dir), ["--smol", "--enable-source-maps", "main.cjs"]))).toEqual({
      stdout: { length: strings.length, wrong: 0, frames: ["at thrower (<dir>/make.ts:7:1)"] },
      stderr: "",
      exitCode: 0,
    });
  });

  // A frame that a read of `.stack` or a collection put in the original file no longer says which module it is
  // from. The source lines of the error are found again by the name of the source.
  test("a printed error has the same source lines when its stack was read or formatted before", async () => {
    const twice = [
      `exports.make = function () {`,
      `  function thrower() { try { return new Error("made"); } finally {} }`,
      `  try { return thrower(); } finally {}`,
      `};`,
      ``,
    ].join("\n");
    const madeIn = (name: string) =>
      JSON.stringify({ version: 3, sources: [`${name}.ts`], names: [], mappings: lineMappings([1, 2, 3, 4]) });
    const text = (name: string) => `// ${name}\n  here(); // ${name}\n`;
    using dir = tempDir("own-source-map-printed-after", {
      // The text is in the map.
      "in-map.js": `${twice}//# sourceMappingURL=in-map.js.map\n`,
      "in-map.js.map": JSON.stringify({ ...JSON.parse(madeIn("in-map")), sourcesContent: [text("in the map")] }),
      // The text is in the file that the map names.
      "on-disk.js": `${twice}//# sourceMappingURL=on-disk.js.map\n`,
      "on-disk.js.map": madeIn("on-disk"),
      "on-disk.ts": text("on the disk"),
      // The map has one text and the file another: the map's is the one.
      "both.js": `${twice}//# sourceMappingURL=both.js.map\n`,
      "both.js.map": JSON.stringify({ ...JSON.parse(madeIn("both")), sourcesContent: [text("in the map")] }),
      "both.ts": text("on the disk"),
      // Nothing has the text.
      "nowhere.js": `${twice}//# sourceMappingURL=nowhere.js.map\n`,
      "nowhere.js.map": madeIn("nowhere"),
      "main.cjs": `
        const name = process.argv[2];
        const { make } = require("./" + name + ".js");
        const [atOnce, read, collected] = [make(), make(), make()];
        void read.stack;
        setImmediate(() => {
          Bun.gc(true);
          for (const error of [atOnce, read, collected]) {
            console.error(error);
            console.error("--");
          }
        });
      `,
    });
    const shown = async (name: string) => {
      const { stderr, exitCode } = await run(String(dir), ["--enable-source-maps", "main.cjs", name]);
      // What is above the message of each error.
      const lines = stderr
        .split("--\n")
        .slice(0, 3)
        .map(error => error.split("\n").slice(0, error.split("\n").indexOf("error: made")));
      return { "at once": lines[0], "after a read of .stack": lines[1], "after a collection": lines[2], exitCode };
    };
    const everyOrder = (lines: string[]) => ({
      "at once": lines,
      "after a read of .stack": lines,
      "after a collection": lines,
      exitCode: 0,
    });
    const previewOf = (name: string) => preview(text(name), "2:1").split("\n");
    expect({
      "in-map": await shown("in-map"),
      "on-disk": await shown("on-disk"),
      "both": await shown("both"),
      "nowhere": await shown("nowhere"),
    }).toEqual({
      "in-map": everyOrder(previewOf("in the map")),
      "on-disk": everyOrder(previewOf("on the disk")),
      "both": everyOrder(previewOf("in the map")),
      "nowhere": everyOrder([]),
    });
  });

  // `%00` in a URL is a NUL in the path that the URL names.
  test("a NUL in the URL of the comment or in a source names no file", async () => {
    using dir = tempDir("own-source-map-nul", {
      ...withUrl("in-the-url.js", "a%00b.js.map"),
      "entry.js": `${transpiled.cjs.code}boom();\n//# sourceMappingURL=entry.js.map\n`,
      "entry.js.map": mapOf("cjs", "a%00b.ts"),
      "main.cjs": `
        ${firstFrame}
        console.log(JSON.stringify(firstFrame(require("./in-the-url.js").boom)));
      `,
    });
    const [caught, printedError] = await Promise.all([
      run(String(dir), ["--enable-source-maps", "main.cjs"]),
      run(String(dir), ["--enable-source-maps", "entry.js"]),
    ]);
    expect(printed(caught)).toEqual({
      stdout: `at boom (<dir>/in-the-url.js:${transpiled.cjs.boom})`,
      stderr: "",
      exitCode: 0,
    });
    // The frame is in the source, whose name has the NUL. Nothing is read for its text.
    expect({ ...printedError, stderr: printedError.stderr.split("\n").slice(0, 2) }).toEqual({
      stdout: "",
      stderr: ["error: kaboom", `      at boom (<dir>/a\0b.ts:${inOriginal.boom})`],
      exitCode: 1,
    });
  });

  // What a bundler makes of two files: each line of `bundle.js` is a line of one of them.
  test("a frame is in the source that its line is from, in a map with two sources", async () => {
    const bundle = [
      `function fromFirst() {`,
      `  throw new Error("first");`,
      `}`,
      `function fromSecond() {`,
      `  throw new Error("second");`,
      `}`,
      `module.exports = { fromFirst, fromSecond };`,
      `//# sourceMappingURL=bundle.js.map`,
      ``,
    ].join("\n");
    using dir = tempDir("own-source-map-two-sources", {
      "bundle.js": bundle,
      // Lines 1 to 3 are lines 11 to 13 of `first.ts`. Lines 4 to 6 are lines 21 to 23 of `second.ts`.
      "bundle.js.map": JSON.stringify({
        version: 3,
        sources: ["src/first.ts", "src/second.ts"],
        names: [],
        mappings: "AAUA;AACA;AACA;ACQA;AACA;AACA",
      }),
      "main.cjs": `
        ${firstFrame}
        const { fromFirst, fromSecond } = require("./bundle.js");
        console.log(JSON.stringify([firstFrame(fromFirst), firstFrame(fromSecond), firstFrame(fromFirst)]));
      `,
    });
    expect(printed(await run(String(dir), ["--enable-source-maps", "main.cjs"]))).toEqual({
      stdout: [
        "at fromFirst (<dir>/src/first.ts:12:1)",
        "at fromSecond (<dir>/src/second.ts:22:1)",
        "at fromFirst (<dir>/src/first.ts:12:1)",
      ],
      stderr: "",
      exitCode: 0,
    });
  });

  // One stack with a frame of each kind: a module with its own map, a file that Bun transpiles, a plain file and a
  // builtin, whose position is not the test's to say. Every reader is asked for all of it.
  test("each frame of a stack with frames of several kinds is in its own file", async () => {
    using dir = tempDir("own-source-map-mixed-stack", {
      ...withMap("lib.js"),
      "typed.ts": [
        `type Erased = { x: number };`,
        `export function typed(cb: () => unknown): unknown {`,
        `  return [0].map(() => cb())[0];`,
        `}`,
        ``,
      ].join("\n"),
      "plain.cjs": `exports.plain = function plain(cb) {\n  return [cb()];\n};\n`,
      "main.cjs": [
        `const lib = require("./lib.js");`,
        `const { typed } = require("./typed.ts");`,
        `const { plain } = require("./plain.cjs");`,
        `const through = f => lib.call(() => typed(() => plain(f)));`,
        `const frames = text => text.split("\\n").slice(1).map(line => line.trim().replace(/^at map .*/, "at map"));`,
        `const out = {};`,
        `try {`,
        `  through(lib.boom);`,
        `} catch (error) {`,
        `  out["Error.stack"] = frames(error.stack);`,
        `}`,
        `Error.prepareStackTrace = (error, sites) =>`,
        `  sites.map(site =>`,
        `    site.getFunctionName() === "map" ? "map" : [site.getFileName(), site.getLineNumber(), site.getColumnNumber()].join(":"),`,
        `  );`,
        `try {`,
        `  through(lib.boom);`,
        `} catch (error) {`,
        `  out["CallSite"] = error.stack;`,
        `}`,
        `Error.prepareStackTrace = undefined;`,
        `console.log(JSON.stringify(out));`,
        `through(lib.boom);`,
        ``,
      ].join("\n"),
    });
    const { stdout, stderr, exitCode } = await run(String(dir), ["--enable-source-maps", "main.cjs"]);
    expect({
      ...JSON.parse(stdout),
      printed: stderr
        .split("\n")
        .filter(line => line.startsWith("      at "))
        .map(line => line.trim().replace(/^at map .*/, "at map")),
      exitCode,
    }).toMatchInlineSnapshot(`
      {
        "CallSite": [
          "<dir>/lib.js:6:15",
          "<dir>/plain.cjs:2:11",
          "<dir>/main.cjs:4:49",
          "map",
          "<dir>/typed.ts:3:14",
          "<dir>/main.cjs:4:37",
          "<dir>/lib.js:9:13",
          "<dir>/main.cjs:4:26",
          "<dir>/main.cjs:17:3",
        ],
        "Error.stack": [
          "at boom (<dir>/lib.ts:4:13)",
          "at plain (<dir>/plain.cjs:2:11)",
          "at <anonymous> (<dir>/main.cjs:4:49)",
          "at map",
          "at typed (<dir>/typed.ts:3:14)",
          "at <anonymous> (<dir>/main.cjs:4:37)",
          "at call (<dir>/lib.ts:8:11)",
          "at through (<dir>/main.cjs:4:26)",
          "at <anonymous> (<dir>/main.cjs:8:3)",
        ],
        "exitCode": 1,
        "printed": [
          "at boom (<dir>/lib.ts:4:13)",
          "at plain (<dir>/plain.cjs:2:11)",
          "at <anonymous> (<dir>/main.cjs:4:49)",
          "at map",
          "at typed (<dir>/typed.ts:3:14)",
          "at <anonymous> (<dir>/main.cjs:4:37)",
          "at call (<dir>/lib.ts:8:11)",
          "at through (<dir>/main.cjs:4:26)",
          "at <anonymous> (<dir>/main.cjs:23:1)",
        ],
      }
    `);
  });
});
