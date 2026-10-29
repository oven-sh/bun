// Drafts an IR text test of the engine (WebKit's aot/tests/codegen, or ../engine-tests/codegen) from a small program: the IR that the front end really writes for
// it, cut down to the program's own files and what they reach.
//
//   bun test/aot/tools/ir-test-from-source.ts main.ts > main.ir        needs testaot: $TESTAOT, or beside the Bun that runs this
//
// The source comes first, as comments, then a header that prints the B3 of every function, then the records with ids from 0 and without positions: those of the
// program's files, the library functions that are still reachable once the flow analysis has run, and what either names. A library function that is only named
// has no body. For the rest of the library testaot puts a stand-in in its place, in which every built-in that is written in JavaScript returns undefined.
// Then: `testaot run main.ir --show-output`, and write the check lines. aot/tests/codegen/README.md in WebKit says how.
// Or name the functions behind `# -- generated:` and let ./update-ir-tests.ts write them.
import { bunEnv, bunExe, tempDir } from "harness";
import { existsSync, readFileSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { testaot, toolEnv } from "../shell/tools";

/** `written`: a file that counts as success where it is there, whatever the exit code. */
function run(cmd: string[], cwd: string, env: typeof bunEnv, written?: string) {
  const { exitCode, stdout, stderr } = Bun.spawnSync({ cmd, cwd, env, stdout: "pipe", stderr: "pipe" });
  if (exitCode !== 0 && !(written && existsSync(written)))
    throw new Error(`${cmd.join(" ")} ended with ${exitCode}:\n${stderr}`);
  return stdout.toString().replaceAll("\r\n", "\n");
}

type IRRecord = { kind: string; id?: string; lines: string[] };

function recordsOf(text: string) {
  const lines = text.split("\n");
  const records: IRRecord[] = [];
  for (let index = 0; index < lines.length; index++) {
    if (!lines[index] || lines[index].startsWith("#")) continue;
    const record: IRRecord = {
      kind: lines[index].split(" ", 1)[0],
      id: /^\w+ ([a-zA-Z]\d+)(?: |$)/.exec(lines[index])?.[1],
      lines: [lines[index]],
    };
    if (record.kind === "function" && lines[index].endsWith("{"))
      while (lines[index] !== "}") record.lines.push(lines[++index]);
    records.push(record);
  }
  return records;
}

const moduleOf = (record: IRRecord) => / module=(m\d+)\b/.exec(record.lines[0])?.[1];
const hasBody = (record: IRRecord) => record.lines.length > 1;

// ` name={..}` or ` name=[..]`, with what is nested in it.
function withoutField(line: string, name: string) {
  const start = line.indexOf(` ${name}=`);
  if (start < 0) return line;
  let depth = 0;
  for (let index = start + name.length + 2; ; index++) {
    if (line[index] === '"') for (index++; line[index] !== '"'; index++) if (line[index] === "\\") index++;
    if ("{[".includes(line[index])) depth++;
    if ("}]".includes(line[index]) && !--depth) return line.slice(0, start) + line.slice(index + 1);
  }
}

const outsideQuotes = (line: string, change: (part: string) => string) =>
  line
    .split(/("(?:[^"\\]|\\.)*")/)
    .map((part, index) => (index % 2 ? part : change(part)))
    .join("");

/**
 * The records of the files of the program whose entry point is `source`, and of what they reach in the library, as IR text.
 * `unknownIDs`: the ids in them that name no record.
 */
export function recordsOfSource(source: string) {
  using folder = tempDir("aot-ir-test-from-source", {});
  const program = join(String(folder), "program.aot");
  // The engine may stop the build with a diagnostic, which is what some tests are about. The front end has written its program by then.
  // A line `// Flags: --aot-erase-types` in the program: the front end reads it as it reads a file without types.
  const flags = /^\/\/ Flags:.* --aot-erase-types\b/m.test(readFileSync(source, "utf8")) ? ["--aot-erase-types"] : [];
  run(
    [bunExe(), "compile", ...flags, `--aot-out=${program}`, basename(source)],
    dirname(resolve(source)),
    bunEnv,
    program,
  );
  const records = recordsOf(run([testaot!, "print", program], String(folder), toolEnv));
  const byID = new Map(records.flatMap(record => (record.id ? [[record.id, record] as const] : [])));

  const ownModules = new Set(
    records
      .filter(({ kind, lines }) => kind === "module" && !/ kind=Runtime| flags=\[[^\]]*\bIsLibrary\b/.test(lines[0]))
      .map(record => record.id!),
  );
  if (!ownModules.size) throw new Error("the printed program has no module for the file");
  const isOwn = (record: IRRecord) => ownModules.has((record.kind === "module" ? record.id : moduleOf(record)) ?? "");

  // A build that stops early prints nothing here: then the stand-in is the whole library.
  const reached = new Set<string>();
  const later = recordsOf(
    run([testaot!, "print", program, "--until=ApplyFlowResults"], String(folder), toolEnv, program),
  );
  const sourceOf = new Map(later.map(record => [record.id, /derivation=\{source=(f\d+)/.exec(record.lines[0])?.[1]]));
  for (const record of later) {
    if (record.kind !== "function" || !hasBody(record)) continue;
    let id = record.id;
    while (sourceOf.get(id)) id = sourceOf.get(id);
    if (id && byID.has(id)) reached.add(id);
  }

  function stripped(record: IRRecord) {
    const isWhole = record.kind !== "function" || isOwn(record) || reached.has(record.id!);
    return record.lines.slice(0, isWhole ? undefined : 1).map((line, index) => {
      if (record.kind === "module")
        return withoutField(line, "positions")
          .replace(/ functionText="(?:[^"\\]|\\.)*"/, "")
          .replace(" flags=[KeepsError]", "")
          .replaceAll("/$bunfs/root/", "")
          .replace(/\/\$bun\/text\/[^"/]*%2f/g, "/$bun/text/");
      if (record.kind === "entry") return withoutField(line, "hostReads");
      if (record.kind === "typesite") return line.replace(/ function=f\d+/, "");
      if (record.kind !== "function") return line;
      if (index) return line.replace(/( @\d+)+( callers| constructs)?$/, "");
      return isWhole ? withoutField(line, "text") : withoutField(line, "text").replace(/ \{$/, "");
    });
  }

  const letters = [...new Set([...byID.keys()].map(id => id[0]))].join("");
  const ids = new RegExp(`(?<![A-Za-z0-9_#$.])[${letters}]\\d+\\b`, "g");
  const texts = new Map<IRRecord, string[]>();
  const unknownIDs = new Set<string>();
  const queue = records.filter(
    record => isOwn(record) || (record.kind === "function" && reached.has(record.id!)) || record.kind === "entry",
  );
  for (const record of queue) texts.set(record, []);
  for (const record of queue) {
    const text = stripped(record);
    texts.set(record, text);
    for (const line of text)
      outsideQuotes(line, part => {
        for (const id of part.match(ids) ?? []) {
          const named = byID.get(id);
          if (!named) unknownIDs.add(id);
          else if (!texts.has(named)) {
            texts.set(named, []);
            queue.push(named);
          }
        }
        return part;
      });
  }
  for (const record of records)
    if (record.kind === "runtimefunction" && reached.has(/ function=(f\d+)/.exec(record.lines[0])?.[1] ?? ""))
      texts.set(record, record.lines);

  const newIDs = new Map<string, string>();
  const counts: Record<string, number> = {};
  for (const record of records)
    if (record.id && texts.has(record))
      newIDs.set(record.id, record.id[0] + (counts[record.id[0]] = (counts[record.id[0]] ?? -1) + 1));
  const renumber = (line: string) => outsideQuotes(line, part => part.replace(ids, id => newIDs.get(id) ?? `${id}?`));

  const kinds = ["module", "entry", "typesite", "layout", "data", "variable", "function", "runtimefunction"];
  const text = kinds.flatMap(kind =>
    records
      .filter(record => record.kind === kind && texts.has(record))
      .flatMap(record => texts.get(record)!.map(renumber)),
  );
  return { text, unknownIDs };
}

if (import.meta.main) {
  const source = process.argv[2];
  if (!source || !testaot) {
    console.error(source ? "there is no testaot" : "usage: bun test/aot/tools/ir-test-from-source.ts <source file>");
    process.exit(2);
  }
  const { text, unknownIDs } = recordsOfSource(source);
  console.log(
    [
      `# -- source: ${basename(source)}`,
      ...readFileSync(source, "utf8")
        .trimEnd()
        .split("\n")
        .map(line => `# ${line}`.trimEnd()),
      "# -- end of source",
      "# FORM: AsRead",
      "# OPTIONS: heat=EverythingIsHot disable=pass:InlineCalls",
      "# RUN: lower-to-b3 optimized",
      "# REQUIRES: unsanitized-code",
      "# CHECK: function",
      "",
      ...text,
      "# -- generated: *",
    ].join("\n"),
  );
  if (unknownIDs.size) console.error(`these name no record: ${[...unknownIDs].join(" ")}`);
}
