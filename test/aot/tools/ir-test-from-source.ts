// Drafts an IR text test of the engine (WebKit's aot/tests/codegen, or ../engine-tests/codegen) from a small program: the IR that the front end really writes for
// it, cut down to the program's own file.
//
//   bun test/aot/tools/ir-test-from-source.ts main.ts > main.ir        needs testaot: $TESTAOT, or beside the Bun that runs this
//
// The source comes first, as comments, then a header that prints the B3 of every function, then the records of the file's module with ids from 0 and without
// positions. The library is left out: testaot puts a stand-in in its place, in which every built-in that is written in JavaScript returns undefined.
// Then: `testaot run main.ir --show-output`, and write the check lines. aot/tests/codegen/README.md in WebKit says how.
// Or name the functions behind `# -- generated:` and let ./update-ir-tests.ts write them.
import { bunEnv, bunExe, tempDir } from "harness";
import { existsSync, readFileSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { testaot, toolEnv } from "../shell/tools";

/** `written`: a file that counts as success where it is there, whatever the exit code. */
function run(cmd: string[], cwd: string, env: typeof bunEnv, written?: string) {
  const { exitCode, stdout, stderr } = Bun.spawnSync({ cmd, cwd, env, stdout: "pipe", stderr: "pipe" });
  if (exitCode !== 0 && !(written && existsSync(written))) {
    console.error(`${cmd.join(" ")} ended with ${exitCode}:\n${stderr}`);
    process.exit(1);
  }
  return stdout.toString().replaceAll("\r\n", "\n");
}

/** The records of the module of `source`, as IR text, and the ids in them that name records of other files. */
export function recordsOfSource(source: string) {
  using folder = tempDir("aot-ir-test-from-source", {});
  const program = join(String(folder), "program.aot");
  // The engine may stop the build with a diagnostic, which is what some tests are about. The front end has written its program by then.
  run([bunExe(), "compile", `--aot-out=${program}`, basename(source)], dirname(resolve(source)), bunEnv, program);
  const lines = run([testaot!, "print", program], String(folder), toolEnv).split("\n");

  const moduleLine = lines.find(
    line => line.startsWith("module ") && line.includes(`/${basename(source)}" displayPath=`),
  );
  if (!moduleLine) throw new Error("the printed program has no module for the file");
  const moduleID = moduleLine.split(" ")[1];
  const isOfModule = (line: string) => new RegExp(` module=${moduleID}\\b`).test(line);

  const kinds = ["module", "entry", "typesite", "layout", "data", "variable", "function"];
  const records = new Map<string, string[][]>(kinds.map(kind => [kind, []]));
  for (let index = 0; index < lines.length; index++) {
    const kind = lines[index].split(" ", 1)[0];
    const record = [lines[index]];
    if (kind === "function" && lines[index].endsWith("{")) while (lines[index] !== "}") record.push(lines[++index]);
    if (kind === "module" ? lines[index] === moduleLine : records.has(kind) && isOfModule(record[0]))
      records.get(kind)!.push(record);
  }

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

  const newIDs = new Map<string, string>();
  for (const kind of kinds)
    for (const [head] of records.get(kind)!) {
      const id = /^\w+ ([a-zA-Z])\d+ /.exec(head);
      if (id) newIDs.set(head.split(" ")[1], id[1] + [...newIDs.keys()].filter(old => old[0] === id[1]).length);
    }
  const letters = [...new Set([...newIDs.keys()].map(id => id[0]))].join("");
  const unknownIDs = new Set<string>();
  const renumber = (line: string) =>
    line
      .split(/("(?:[^"\\]|\\.)*")/)
      .map((part, index) =>
        index % 2
          ? part
          : part.replace(new RegExp(`(?<![A-Za-z0-9_@#$.])[${letters}]\\d+\\b`, "g"), id => {
              if (!newIDs.has(id)) unknownIDs.add(id);
              return newIDs.get(id) ?? `${id}?`;
            }),
      )
      .join("");

  const text: string[] = [];
  for (const kind of kinds)
    for (const record of records.get(kind)!)
      for (let [index, line] of record.entries()) {
        if (kind === "module") {
          for (const field of ["positions", "requests", "exports", "imports"]) line = withoutField(line, field);
          line = line
            .replace(/ functionText="(?:[^"\\]|\\.)*"/, "")
            .replace(/ namespaceLayout=\S+/, "")
            .replace(" flags=[KeepsError]", "")
            .replace(/path="[^"]*"/, `path="${basename(source)}"`)
            .replace(/displayPath="[^"]*"/, `displayPath="${basename(source)}"`);
        }
        if (kind === "entry") line = withoutField(line, "hostReads");
        if (kind === "function")
          line = index ? line.replace(/( @\d+)+( callers| constructs)?$/, "") : withoutField(line, "text");
        text.push(renumber(line));
      }

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
  if (unknownIDs.size)
    console.error(`these name records of other files, which were left out: ${[...unknownIDs].join(" ")}`);
}
