// Drafts an IR text test of the engine (WebKit's aot/tests) from a small program: the IR that the front end really writes for
// it, cut down to the program's own files and what they reach.
//
//   bun test/aot/tools/ir-test-from-source.ts main.ts > main.ir        needs testaot: $TESTAOT, or beside the Bun that runs this
//
// The source comes first, as comments, then a header that prints the code that the walk builds for every function, then the records with ids from 0: those of the
// program's files, the library functions that Link does not call unreached, and what either names. A library function that is only named
// has a body that ends at once.
// Then: `testaot run main.ir --show-output`, and write the check lines.
// Or add `# -- generated: f0 f2` as the last line, naming functions by id, and let ./update-ir-tests.ts write them. Delete the draft's CHECK line:
// it needs a match above the first label, and `walk` prints nothing above its first unit.
import { bunEnv, bunExe, tempDir } from "harness";
import { existsSync, readFileSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { testaot, toolEnv } from "../shell/tools";

/** `written`: a file that counts as success where it is there, whatever the exit code. What a signal has ended has not succeeded. */
function run(cmd: string[], cwd: string, env: typeof bunEnv, written?: string) {
  const { exitCode, signalCode, stdout, stderr } = Bun.spawnSync({ cmd, cwd, env, stdout: "pipe", stderr: "pipe" });
  const hasDied = signalCode !== undefined || exitCode > 128;
  if (hasDied || (exitCode !== 0 && !(written && existsSync(written))))
    throw new Error(`${cmd.join(" ")} ended with ${signalCode ?? exitCode}:\n${stderr}`);
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
 * Without `keepsLibrary` no library function keeps its body.
 */
export function recordsOfSource(source: string, keepsLibrary = true) {
  using folder = tempDir("aot-ir-test-from-source", {});
  const program = join(String(folder), "program.aot");
  // The engine may stop the build with a diagnostic, which is what some tests are about. The front end has written its program by then.
  // A line `// Flags: --aot-erase-types` in the program: the front end reads it as it reads a file without types.
  const flags = /^\/\/ Flags:.* --aot-erase-types\b/m.test(readFileSync(source, "utf8")) ? ["--aot-erase-types"] : [];
  run(
    // Only the program is wanted. The executable is as large as Bun, and writing it takes longer than the build.
    [bunExe(), "compile", ...flags, `--aot-out=${program}`, "--aot-testing=NoExecutable", basename(source)],
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

  // A line `function f3 unreached ..` for each function that nothing reaches. A build that stops early says nothing of any function:
  // then no library function keeps its body.
  const linkedFunctions = run([testaot!, "link", program, "functions"], String(folder), toolEnv, program)
    .split("\n")
    .filter(line => line.startsWith("function "));
  const unreached = new Set(linkedFunctions.flatMap(line => /^function (f\d+) unreached\b/.exec(line)?.[1] ?? []));
  const reached = new Set(
    records
      .filter(record => keepsLibrary && linkedFunctions.length && record.kind === "function" && hasBody(record))
      .map(record => record.id!)
      .filter(id => !unreached.has(id)),
  );

  function stripped(record: IRRecord) {
    const isWhole = record.kind !== "function" || isOwn(record) || reached.has(record.id!) || !hasBody(record);
    // The verifier wants a body where the role says that there is one: the first block, which takes what the function takes, and no way on.
    const lines = isWhole ? record.lines : [...record.lines.slice(0, 2), "    Unreachable", "}"];
    return lines.map((line, index) => {
      if (record.kind === "module")
        return withoutField(line, "positions")
          .replace(/ functionText="(?:[^"\\]|\\.)*"/, "")
          .replace(" flags=[KeepsError]", "")
          .replaceAll("/$bunfs/root/", "")
          .replace(/\/\$bun\/text\/[^"/]*%2f/g, "/$bun/text/");
      if (record.kind === "entry") return withoutField(line, "hostReads");
      if (record.kind === "typesite") return line.replace(/ function=f\d+/, "");
      if (record.kind !== "function") return line;
      // An operation says where in the text it stands, as in a build of the program.
      if (index) return line;
      return withoutField(line, "text");
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

  const kinds = [
    "module",
    "entry",
    "typesite",
    "expectedresult",
    "layout",
    "data",
    "variable",
    "evalscope",
    "function",
    "runtimefunction",
  ];
  // The reader makes the layouts by tag itself. A printed type names them beside the others, no record does, and the reader puts them back.
  const text = kinds.flatMap(kind =>
    records
      .filter(record => record.kind === kind && texts.has(record))
      .flatMap(record => texts.get(record)!.map(line => renumber(line).replace(/\|L\d+\?/g, ""))),
  );
  for (const id of unknownIDs) if (!text.some(line => line.includes(`${id}?`))) unknownIDs.delete(id);
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
      "# RUN: walk",
      "# CHECK: code",
      "",
      ...text,
    ].join("\n"),
  );
  if (unknownIDs.size) console.error(`these name no record: ${[...unknownIDs].join(" ")}`);
}
