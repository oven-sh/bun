// Compares what `run-eslint.ts` printed with what `bun-lint js_plugin batch` printed for the same cases.
//
//   bun compare.ts cases.jsonl expected.jsonl actual.jsonl [--show=n] [--json: the one message of a case is JSON, show the first difference in it]
//     [--recorded: the expected messages are those of `conformance.ts`, which have no `data` in their suggestions]

import { readFileSync } from "node:fs";

const flags = process.argv.slice(2).filter(it => it.startsWith("--"));
const [casesPath, expectedPath, actualPath] = process.argv.slice(2).filter(it => !it.startsWith("--"));
const show = Number(flags.find(it => it.startsWith("--show="))?.slice(7) ?? 3);
const isJson = flags.includes("--json");
const isRecorded = flags.includes("--recorded");
const read = (path: string) =>
  readFileSync(path, "utf8")
    .split("\n")
    .filter(it => it.startsWith("{"))
    .map(line => JSON.parse(line));
const cases = new Map(read(casesPath).map(it => [it.id, it]));
const actual = new Map(read(actualPath).map(it => [it.id, it]));

// Where two values differ first: the path, and the two values there.
function difference(a: any, b: any, path = ""): [string, unknown, unknown] | null {
  if (a === b) return null;
  // With an old `ecmaVersion` espree leaves out the fields that newer syntax has brought.
  if (a === undefined && /\/(?:optional|async|attributes|computed|await|options|directive|generator|expression|method|shorthand)$/.test(path)) return null;
  if (isRecorded && a === undefined && /\/suggestions\/\d+\/data$/.test(path)) return null;
  if (typeof a !== "object" || typeof b !== "object" || a === null || b === null || Array.isArray(a) !== Array.isArray(b)) {
    return [path, a, b];
  }
  for (const key of new Set([...Object.keys(a), ...Object.keys(b)])) {
    const found = difference(a[key], b[key], `${path}/${key}`);
    if (found) return found;
  }
  return null;
}

let [same, different, refusedByThem, failedHere] = [0, 0, 0, 0];
const kinds = new Map<string, { count: number; examples: string[] }>();
function note(kind: string, example: string) {
  const entry = kinds.get(kind) ?? { count: 0, examples: [] };
  entry.count++;
  if (entry.examples.length < show) entry.examples.push(example);
  kinds.set(kind, entry);
}
for (const theirs of read(expectedPath)) {
  const ours = actual.get(theirs.id);
  const it = cases.get(theirs.id);
  const title = `#${theirs.id} ${it.name ?? it.filename} ${JSON.stringify(it.languageOptions)}\n${it.name ? "" : it.code.slice(0, 600)}`;
  if (theirs.failure) {
    refusedByThem++;
    continue;
  }
  if (!ours || ours.failure) {
    failedHere++;
    note(`failure: ${String(ours?.failure).split("\n")[0].slice(0, 100)}`, title);
    continue;
  }
  const parse = (messages: any[]) => (isJson && messages.length === 1 ? JSON.parse(messages[0].message) : messages);
  const found = difference(parse(theirs.messages), parse(ours.messages));
  if (!found) {
    same++;
    continue;
  }
  different++;
  // The last names in the path.
  const kind = found[0].replace(/\/\d+/g, "").split("/").slice(-2).join("/");
  note(kind, `${title}\n  at ${found[0]}\n  expected: ${JSON.stringify(found[1])?.slice(0, 300)}\n  actual:   ${JSON.stringify(found[2])?.slice(0, 300)}`);
}
for (const [kind, { count, examples }] of [...kinds].sort((a, b) => b[1].count - a[1].count)) {
  console.log(`──── ${count} × ${kind}`);
  for (const example of examples) console.log(`${example}\n`);
}
console.log(`${same} the same, ${different} different, ${failedHere} failed here, ${refusedByThem} that ESLint refuses`);
