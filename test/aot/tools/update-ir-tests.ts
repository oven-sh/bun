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
//
// With --check-inputs it writes nothing: it says of each file with a source whether the front end still makes the file's IR of it, and
// exits with 1 if one does not. The files are shared out among as many processes as there are cores.
//
// With --check-anew it writes nothing either. A text goes stale with every change to the library that rides along in it, so a stale text says
// little. It writes each file with a source anew in a temporary folder, without the generated listing, and runs it there: do the check lines
// that somebody wrote hold for what the front end makes today? `--part=1/2` takes every second file.
//
// With --counts it then runs every file, marked or not. Where a check line fails and the nearest line of the output differs from it
// only in numbers (`instructions: 14, patchpoints: 2`), the check line takes those numbers, and the old and the new line are printed.
import { tempDir } from "harness";
import { readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { availableParallelism } from "node:os";
import { basename, join } from "node:path";
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

/**
 * A pattern that one printed line matches. Positions in the source are left out. A check line matches part of a line, so the start of a
 * very long one is enough: a folded string of 70,000 characters is printed on one line.
 */
const patternOf = (line: string) =>
  line
    .trim()
    .replace(/( @\d+(:\d+)*)+( callers| constructs)?$/, "")
    .slice(0, 4000)
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

const runsOf = (lines: string[]) =>
  lines.flatMap((line, index) => {
    const [, , prefix] = /^# RUN(\(([A-Z0-9]+)\))?: /.exec(line) ?? [];
    return /^# RUN[(:]/.test(line) ? [{ prefix: prefix ?? "CHECK", line: index + 1 }] : [];
  });
const hasOwnLines = (lines: string[], prefix: string) =>
  lines.some(line => new RegExp(`^# ${prefix}(-[A-Z0-9-]+)?: `).test(line));

function failuresOf(path: string, lines: string[]) {
  // A prefix needs a line before testaot runs anything.
  const placeholders = runsOf(lines)
    .filter(({ prefix, line }) => !lines[line - 1].startsWith("# RUN(%") && !hasOwnLines(lines, prefix))
    .map(({ prefix }) => `# ${prefix}: function`);
  using folder = tempDir("aot-ir-test-anew", { [basename(path)]: [...lines, ...placeholders].join("\n") + "\n" });
  const { stdout, stderr } = Bun.spawnSync([testaot!, "run", basename(path)], { cwd: String(folder), env: toolEnv });
  const printed = stdout.toString().replaceAll("\r\n", "\n").split("\n");
  const failures = printed.filter(line => line.startsWith("FAIL "));
  if (failures.length || printed.some(line => /^\d+ passed, 0 failed, \d+ todo$/.test(line))) return failures;
  return [`testaot printed: ${printed.join(" ")}${stderr}`];
}

function update(path: string, checks?: "inputs" | "anew") {
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
  if (checks === "anew") {
    if (sourceAt < 0) return "no source";
    const failures = failuresOf(path, marked() < 0 ? lines : lines.slice(0, marked()));
    if (failures.length === 0) return "passes";
    console.log(
      [`${path}: it fails on what the front end makes today`, ...failures.map(line => `  ${line}`)].join("\n"),
    );
    return "fails";
  }
  if (checks === "inputs") {
    if (sourceAt < 0) return "no source";
    const old = before.replace(/\n$/, "").split("\n");
    const at = lines.findIndex((line, index) => line !== old[index]);
    if (at < 0 && lines.length === old.length) return "as it was";
    console.log(
      `${path}:${(at < 0 ? lines.length : at) + 1}: the source lowers to something else\n  - ${old[at] ?? ""}\n  + ${lines[at] ?? ""}`,
    );
    return "stale";
  }

  const at = marked();
  if (at >= 0) {
    const functions = generatedMark.exec(lines[at])![1].trim().split(/\s+/);
    const kept = lines.slice(0, at + 1);
    const runs = runsOf(kept);
    // A prefix needs a line before testaot runs anything.
    const placeholders = runs.map(({ prefix }) => `# ${prefix}: function`);
    // Without the marker: testaot wants a label below it for each function that it names.
    writeFileSync(path, [...kept.slice(0, -1), ...placeholders].join("\n") + "\n");
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
    const empty = runs.filter((run, index) => generated[index].length === 0 && !hasOwnLines(kept, run.prefix));
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

const withoutNumbers = (text: string) => text.replace(/\d+/g, "0");

/** One round: a later check line of a file is only reached once the earlier ones match. */
function updateCounts(paths: string[]) {
  const { stdout } = Bun.spawnSync([testaot!, "run", ...paths], { env: toolEnv });
  const failure = /^FAIL (.+):(\d+): .*?(?: matches| does not match): (.*); nearest: (.*)$/;
  let rewritten = 0;
  for (const printed of stdout.toString().replaceAll("\r\n", "\n").split("\n")) {
    const [, path, number, pattern, nearest] = failure.exec(printed) ?? [];
    if (!path || pattern === nearest || withoutNumbers(pattern) !== withoutNumbers(nearest)) continue;
    const lines = readFileSync(path, "utf8").split("\n");
    const line = lines[Number(number) - 1];
    if (!line?.endsWith(pattern)) continue;
    lines[Number(number) - 1] = line.slice(0, line.length - pattern.length) + nearest;
    writeFileSync(path, lines.join("\n"));
    console.log(`${path}:${number}\n  - ${pattern}\n  + ${nearest}`);
    rewritten++;
  }
  return rewritten;
}

const takesCounts = process.argv.includes("--counts");
const checks = process.argv.includes("--check-inputs")
  ? "inputs"
  : process.argv.includes("--check-anew")
    ? "anew"
    : undefined;
const [part, parts] = (process.argv.find(argument => argument.startsWith("--part="))?.slice(7) ?? "1/1")
  .split("/")
  .map(Number);
const paths = process.argv.slice(2).filter(argument => !argument.startsWith("--"));
if (!testaot || paths.length === 0) {
  console.error(
    testaot
      ? "usage: bun test/aot/tools/update-ir-tests.ts [--counts | --check-inputs | --check-anew] <file or folder> .."
      : "there is no testaot",
  );
  process.exit(2);
}
if (checks && paths.some(path => statSync(path).isDirectory())) {
  const files = paths
    .flatMap(filesBelow)
    .filter(
      path =>
        sourceMark.test(readFileSync(path, "utf8").split("\n", 1)[0]) ||
        /^# -- source: /m.test(readFileSync(path, "utf8")),
    )
    .filter((_, index) => index % parts === part - 1);
  const shares = Math.min(files.length, availableParallelism());
  const children = Array.from({ length: shares }, (_, share) =>
    Bun.spawn(
      [
        process.execPath,
        import.meta.path,
        `--check-${checks}`,
        ...files.filter((_, index) => index % shares === share),
      ],
      {
        stdout: "pipe",
        stderr: "inherit",
      },
    ),
  );
  const printed = await Promise.all(children.map(child => new Response(child.stdout).text()));
  const problems = printed.flatMap(text =>
    text.split("\n").filter(line => line && !/^\d+ (as it was|stale|failed|passes|fails)/.test(line)),
  );
  console.log(
    [
      ...problems,
      `${files.length} files with a source, ${problems.filter(line => !line.startsWith("  ")).length} stale or failed`,
    ].join("\n"),
  );
  process.exit(problems.length ? 1 : 0);
}
const counts: Record<string, number> = {};
for (const path of paths.flatMap(filesBelow)) {
  let what = "failed";
  try {
    what = update(path, checks);
  } catch (error) {
    (checks ? console.log : console.error)(`${path}: ${error instanceof Error ? error.message.split("\n")[0] : error}`);
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
if (takesCounts) {
  let total = 0;
  for (let rewritten; (rewritten = updateCounts(paths)) > 0;) total += rewritten;
  console.log(`${total} check lines took other numbers`);
}
