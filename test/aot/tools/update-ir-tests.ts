// Writes an IR text test of the engine anew from what the file itself holds, as `bun test -u` does for snapshots.
//
//   bun test/aot/tools/update-ir-tests.ts <file or folder> ..        needs testaot: $TESTAOT, or beside the Bun that runs this
//
// A file takes part with one or both of these comment lines, which testaot reads as comments:
//
//   # -- source: main.ts        the lines down to `# -- end of source` are a program, each behind `# `. A further such line
//   # -- end of source          begins a further file, which the first one loads. The IR text of the file is written anew:
//                               what the front end makes of that program today (./ir-test-from-source.ts).
//   # -- generated: add f0      Every line below is written anew: for each RUN, each named function as the run prints it,
//                               or with `*` every function that has a name: a -LABEL on its name and a -NEXT for every line.
//                               `f0` is the function with that id, for one without a name.
//
// So an input does not go stale against the front end, and a change of what a pass prints is this command and a diff to read.
import { tempDir } from "harness";
import { readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { testaot, toolEnv } from "../shell/tools";
import { recordsOfSource } from "./ir-test-from-source";

const sourceMark = /^# -- source: (\S+)$/;
const endOfSource = "# -- end of source";
const generatedMark = /^# -- generated: (.+)$/;

const filesBelow = (path: string): string[] =>
  statSync(path).isDirectory()
    ? readdirSync(path, { recursive: true, encoding: "utf8" })
        .filter(name => name.endsWith(".ir"))
        .sort()
        .map(name => join(path, name))
    : [path];

/** A pattern that one printed line matches. Positions in the source are left out. */
const patternOf = (line: string) =>
  line
    .trim()
    .replace(/( @\d+(:\d+)*)+( callers| constructs)?$/, "")
    .replace(/\{(?=\{)|\[(?=\[)/g, "{{*}}");

function generate(prefix: string, output: string[], functions: string[]) {
  const lines: string[] = [];
  // lower-to-b3 and lower-to-air end a function with a line of words, the printer of the IR with a brace.
  const endsWithWords = output.some(line => line.startsWith("end of function "));
  let isWanted = false;
  for (const line of output) {
    if (line.startsWith("function ")) {
      const name = / name="((?:[^"\\]|\\.)*)"/.exec(line);
      const id = /^function f\d+/.exec(line)!;
      const isNamed = name !== null && (functions.includes("*") || functions.includes(name[1]));
      isWanted = isNamed || functions.includes(id[0].slice(9));
      if (!isWanted) continue;
      // `function f1` alone is also the beginning of `function f10`.
      const label = isNamed ? `function {{*}}${name[0].trim()}` : line.slice(0, line.indexOf("=") + 1);
      lines.push(`# ${prefix}-LABEL: ${label}`);
      const rest = line.slice(isNamed ? name.index + name[0].length : label.length);
      if (rest.trim()) lines.push(`# ${prefix}: ${patternOf(rest)}`);
      isWanted = endsWithWords || line.endsWith("{");
    } else if (isWanted && line.trim()) {
      lines.push(`# ${prefix}-NEXT: ${patternOf(line)}`);
      isWanted = endsWithWords ? !line.startsWith("end of function ") : line !== "}";
    }
  }
  return lines;
}

function update(path: string) {
  const before = readFileSync(path, "utf8");
  let lines = before.replace(/\n$/, "").split("\n");
  const sourceAt = lines.findIndex(line => sourceMark.test(line));
  const marked = () => lines.findIndex(line => generatedMark.test(line));
  if (sourceAt < 0 && marked() < 0) return "no mark";

  if (sourceAt >= 0) {
    const end = lines.indexOf(endOfSource);
    if (end < sourceAt) throw new Error(`${path}: there is no line "${endOfSource}"`);
    const files: Record<string, string> = {};
    let name = "";
    for (const line of lines.slice(sourceAt, end)) {
      const mark = sourceMark.exec(line);
      if (mark) files[(name = mark[1])] = "";
      else files[name] += line.replace(/^# ?/, "") + "\n";
    }
    using folder = tempDir("aot-update-ir-tests", files);
    const { text: records, unknownIDs } = recordsOfSource(join(String(folder), sourceMark.exec(lines[sourceAt])![1]));
    if (unknownIDs.size) console.error(`${path}: these name no record: ${[...unknownIDs].join(" ")}`);
    // The IR text is what is no comment. Comments between its lines are check lines written by hand: they stay in front of it.
    const last = marked() < 0 ? lines.length : marked();
    const comments = lines.slice(0, last).filter(line => line.startsWith("#"));
    lines = [...comments, "", ...records, ...lines.slice(last)];
  }

  const at = marked();
  if (at >= 0) {
    const functions = generatedMark.exec(lines[at])![1].trim().split(/\s+/);
    const kept = lines.slice(0, at + 1);
    const runs = kept.flatMap((line, index) => {
      const [, , prefix] = /^# RUN(\(([A-Z0-9]+)\))?: /.exec(line) ?? [];
      return /^# RUN[(:]/.test(line) ? [{ prefix: prefix ?? "CHECK", line: index + 1 }] : [];
    });
    // A prefix needs a line before testaot runs anything.
    const placeholders = runs.map(({ prefix }) => `# ${prefix}: function`);
    writeFileSync(path, [...kept, ...placeholders].join("\n") + "\n");
    const { stdout, stderr } = Bun.spawnSync([testaot!, "run", path, "--show-output"], { env: toolEnv });
    const printed = stdout.toString().replaceAll("\r\n", "\n").split("\n");
    const outputs = new Map<number, string[]>();
    let current: string[] | undefined;
    for (const line of printed) {
      const [, number] = /^OUTPUT .*:(\d+):$/.exec(line) ?? [];
      if (number) outputs.set(Number(number), (current = []));
      else if (/^(PASS|FAIL|TODO|SKIP) |^\d+ passed, /.test(line)) current = undefined;
      else current?.push(line);
    }
    if (outputs.size === 0) {
      writeFileSync(path, before);
      throw new Error(`${path}: testaot printed no output:\n${printed.join("\n")}${stderr}`);
    }
    const generated = runs.map(run => generate(run.prefix, outputs.get(run.line) ?? [], functions));
    // A RUN that prints no function, as `compile`, has its check lines above the mark.
    const hasOwnLines = (prefix: string) => kept.some(line => new RegExp(`^# ${prefix}(-[A-Z0-9-]+)?: `).test(line));
    const empty = runs.filter((run, index) => generated[index].length === 0 && !hasOwnLines(run.prefix));
    if (empty.length) {
      writeFileSync(path, before);
      throw new Error(
        `${path}: ${empty.map(run => `the RUN of line ${run.line}`).join(", ")} prints none of: ${functions.join(" ")}`,
      );
    }
    lines = [...kept, ...generated.flat()];
  }
  const after = lines.join("\n") + "\n";
  writeFileSync(path, after);
  return after === before ? "as it was" : "written";
}

if (!testaot || process.argv.length < 3) {
  console.error(testaot ? "usage: bun test/aot/tools/update-ir-tests.ts <file or folder> .." : "there is no testaot");
  process.exit(2);
}
const counts: Record<string, number> = {};
for (const path of process.argv.slice(2).flatMap(filesBelow)) {
  let what = "failed";
  try {
    what = update(path);
  } catch (error) {
    console.error(`${path}: ${error instanceof Error ? error.message : error}`);
    process.exitCode = 1;
  }
  counts[what] = (counts[what] ?? 0) + 1;
  if (what === "written") console.log(path);
}
console.log(
  Object.entries(counts)
    .map(([what, count]) => `${count} ${what}`)
    .join(", "),
);
