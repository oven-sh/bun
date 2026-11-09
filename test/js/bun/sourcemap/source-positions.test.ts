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
import { readFileSync } from "node:fs";
import { SourceMap } from "node:module";
import { join } from "node:path";
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
