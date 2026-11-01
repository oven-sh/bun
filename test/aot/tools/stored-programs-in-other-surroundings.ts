// Rewrites a COPY of the stored programs so that each does what it did, in surroundings that take something away from the compiler.
// The programs were written to show one thing each. Eight thousand of them, changed in one mechanical way, show what nobody thought of writing down.
//
//   bun test/aot/tools/stored-programs-in-other-surroundings.ts <surroundings> <a copy of test/aot/parallel>
//
//   open-world               one line behind the leading comments of every file: a store under a name nobody knows to an object nobody knows. It prints nothing.
//                            What flow had proven of the program's objects becomes a guard of the run, so every path behind a failed guard is compiled, and some are taken.
//   loops-in-try             try { LOOP } finally { count }: the error goes on
//   loops-in-try-and-catch   try { LOOP } catch (error) { throw error; } finally { count }
//                            Every loop, on the lines where it stands, so no line number moves. A loop in a loop then stands in a try in a loop.
//                            Whatever a pass moves out of a loop would leave a handler, and every block that a pass puts in front of a loop stands at a handler's border.
//
// The driver takes the programs from beside itself, so copy the tree's `test` folder, rewrite `aot/parallel` in the copy and run the copy's `aot/run-parallel.ts`:
// at default flags, and with --more-flags=--aot-check=verify-each-pass or --more-flags=--aot-validate for every program, with --each-alone. The driver holds each rewritten
// program against plain Bun on the same text. What to look at: an answer that is not plain Bun's, a signal, a build that stops, a line of the validator.
//
// With every loop in a try, --aot-verify-each-pass stopped six builds of 8,642 that build as they stand. One was a look-up in a Map that left its `try` with the loop:
// at default flags an error then passed the `catch` that plain Bun gives it to.
//
// These notice the change and fail for that alone. In an open world: programs whose stored output says what a closed world refuses or leaves out, pins on counts of functions
// (one such line takes an image from two dozen functions to 1,800), stored line numbers, and files whose first line declares their format.
// With loops in a try: programs that list the properties of globalThis.
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import ts from "typescript";

const [surroundings, folder] = process.argv.slice(2);
if (!["open-world", "loops-in-try", "loops-in-try-and-catch"].includes(surroundings) || !folder) {
  console.error(
    "usage: stored-programs-in-other-surroundings.ts <open-world | loops-in-try | loops-in-try-and-catch> <a copy of test/aot/parallel>",
  );
  process.exit(1);
}

const isTyped = (path: string) => /\.[cm]?tsx?$/.test(path);

function openWorld(path: string, text: string) {
  const lines = text.split("\n");
  let at = 0;
  while (at < lines.length && (lines[at].startsWith("//") || lines[at].startsWith("#!") || !lines[at].trim())) at++;
  if (lines[at]?.trimStart().startsWith("/*")) return undefined;
  while (at < lines.length && /^\s*["']use [a-z]+["'];?\s*$/.test(lines[at])) at++;
  const somebody = isTyped(path) ? "const somebody: any = (globalThis as any)" : "const somebody = globalThis";
  lines.splice(at, 0, `{ ${somebody}[JSON.parse('"somebody"')] ?? {}; somebody[JSON.parse('"something"')] = 1; }`);
  return { text: lines.join("\n"), changes: 1 };
}

function parse(path: string, text: string) {
  const kind = path.endsWith(".tsx")
    ? ts.ScriptKind.TSX
    : path.endsWith(".jsx")
      ? ts.ScriptKind.JSX
      : isTyped(path)
        ? ts.ScriptKind.TS
        : ts.ScriptKind.JS;
  const source = ts.createSourceFile(path, text, ts.ScriptTarget.Latest, true, kind);
  return (source as unknown as { parseDiagnostics?: unknown[] }).parseDiagnostics?.length ? undefined : source;
}

function loopsInTry(path: string, text: string) {
  const source = parse(path, text);
  if (!source) return undefined;
  const everything = isTyped(path) ? "(globalThis as any)" : "globalThis";
  const count = `${everything}.loopsLeft = (${everything}.loopsLeft | 0) + 1;`;
  const rethrown = surroundings === "loops-in-try" ? "" : " catch (caughtAroundLoop) { throw caughtAroundLoop; }";
  const edits: { at: number; what: string }[] = [];
  const visit = (node: ts.Node) => {
    if (ts.isIterationStatement(node, false)) {
      let outer: ts.Node = node;
      while (ts.isLabeledStatement(outer.parent)) outer = outer.parent;
      edits.push(
        { at: outer.getStart(source), what: "try { " },
        { at: outer.getEnd(), what: ` }${rethrown} finally { ${count} }` },
      );
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  // At one place an end goes in front of a beginning, and the end of an inner loop in front of the end of the outer one: the order in which they were found, turned round.
  let out = text;
  for (const { at, what } of edits
    .map((edit, index) => ({ ...edit, index }))
    .sort((a, b) => b.at - a.at || b.index - a.index))
    out = out.slice(0, at) + what + out.slice(at);
  return parse(path, out) ? { text: out, changes: edits.length / 2 } : undefined;
}

let files = 0;
let changes = 0;
let leftAlone = 0;
for (const entry of readdirSync(folder, { recursive: true, withFileTypes: true })) {
  const path = join(entry.parentPath, entry.name);
  if (!entry.isFile() || !/\.[cm]?[jt]sx?$/.test(path) || /\.d\.[cm]?ts$/.test(path) || path.includes("node_modules"))
    continue;
  const bytes = readFileSync(path);
  const text = bytes.toString("utf8");
  let rewritten: { text: string; changes: number } | undefined;
  // A file that is not UTF-8 would not come back as it was. A program that nests deeper than the parser's stack throws.
  try {
    if (Buffer.from(text, "utf8").equals(bytes))
      rewritten = surroundings === "open-world" ? openWorld(path, text) : loopsInTry(path, text);
  } catch {}
  if (!rewritten) {
    leftAlone++;
    continue;
  }
  if (!rewritten.changes) continue;
  writeFileSync(path, rewritten.text);
  files++;
  changes += rewritten.changes;
}
console.log(
  `${surroundings}: ${changes} ${surroundings === "open-world" ? "lines" : "loops"} in ${files} files; left as they are: ${leftAlone}`,
);
