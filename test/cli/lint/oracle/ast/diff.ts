// Compares the ESTree of `bun-lint ast estree-batch` with that of typescript-estree.
//
//   bun diff.ts <inputs.jsonl> <expected.jsonl> <actual.jsonl> [--show <class>] [--examples <n>] [--rejected]
//
// Prints the classes of mismatches, by node type and field, the most frequent first.
// --show: every mismatch of the classes that contain this text, with the code.
// --rejected: lists the inputs that only one side rejects.
import { closeSync, openSync, readSync } from "node:fs";

const [inputsPath, expectedPath, actualPath, ...flags] = process.argv.slice(2);
const flag = (name: string) => (flags.includes(name) ? (flags[flags.indexOf(name) + 1] ?? "") : undefined);
const show = flag("--show");
const examples = Number(flag("--examples") ?? 3);

// The lines of a file, which can be larger than a string can be.
function* read(path: string) {
  const file = openSync(path, "r");
  const chunk = Buffer.alloc(1 << 24);
  let rest: Buffer = Buffer.alloc(0);
  for (let length; (length = readSync(file, chunk, 0, chunk.length, null)) > 0; ) {
    let data = rest.length ? Buffer.concat([rest, chunk.subarray(0, length)]) : chunk.subarray(0, length);
    for (let end; (end = data.indexOf(10)) >= 0; data = data.subarray(end + 1)) {
      if (end > 0) yield data.toString("utf8", 0, end);
    }
    rest = Buffer.from(data);
  }
  if (rest.length) yield rest.toString("utf8");
  closeSync(file);
}
// The three files have a line for each input, in the same order.
const inputs = read(inputsPath);
const actualLines = read(actualPath);
const code = new Map<string, string>();

type Mismatch = { kind: string; path: string; expected: unknown; actual: unknown; range?: [number, number] };

function compare(expected: any, actual: any, path: string, owner: any, field: string, into: Mismatch[]) {
  const where = `${owner?.type ?? "?"}.${field}`;
  const report = (what: string, e: unknown = expected, a: unknown = actual) =>
    into.push({ kind: `${where}: ${what}`, path, expected: brief(e), actual: brief(a), range: owner?.range });
  if (Array.isArray(expected)) {
    if (!Array.isArray(actual)) return report("not a list");
    if (field === "range") {
      if (expected[0] !== actual[0]) report("start");
      if (expected[1] !== actual[1]) report("end");
      return;
    }
    if (expected.length !== actual.length) return report("length", expected.length, actual.length);
    expected.forEach((it, i) => compare(it, actual[i], `${path}[${i}]`, owner, field, into));
    return;
  }
  if (expected === null || typeof expected !== "object") {
    if (expected !== actual) report(actual !== null && typeof actual === "object" ? "node instead of value" : "value");
    return;
  }
  if (actual === null || typeof actual !== "object" || Array.isArray(actual)) return report("value instead of node");
  if (expected.type !== actual.type) return report(`${expected.type} expected, ${actual.type} found`, expected.type, actual.type);
  const inner = expected.type ? expected : owner;
  for (const key of Object.keys(expected)) {
    if (!(key in actual)) {
      into.push({ kind: `${inner?.type}.${key}: missing`, path, expected: brief(expected[key]), actual: undefined, range: inner?.range });
    } else {
      compare(expected[key], actual[key], `${path}.${key}`, inner, expected.type ? key : `${field}.${key}`, into);
    }
  }
  for (const key of Object.keys(actual)) {
    if (!(key in expected)) {
      into.push({ kind: `${inner?.type}.${key}: extra`, path, expected: undefined, actual: brief(actual[key]), range: inner?.range });
    }
  }
}

function brief(value: unknown) {
  const text = JSON.stringify(value);
  return text === undefined || text.length <= 100 ? text : text.slice(0, 100) + "…";
}

const classes = new Map<string, { count: number; inputs: Set<string>; examples: string[] }>();
let same = 0, different = 0, bothReject = 0;
const onlyWeReject: string[] = [], onlyTheyReject: string[] = [], failures: string[] = [];
for (const line of read(expectedPath)) {
  const expected = JSON.parse(line);
  const input = JSON.parse(inputs.next().value || "{}");
  const ours = JSON.parse(actualLines.next().value || `{"error":"no output"}`);
  if (input.id !== expected.id || (ours.id ?? expected.id) !== expected.id) throw new Error(`the files are not in step at ${expected.id}`);
  const remember = () => code.set(expected.id, input.code.length > 100_000 ? input.code.slice(0, 100_000) : input.code);
  if (ours.error && ours.error !== "parse") failures.push(`${expected.id}: ${ours.error}`);
  if (expected.error || ours.error) {
    if (expected.error && ours.error) bothReject++;
    else if (ours.error) (remember(), onlyWeReject.push(expected.id));
    else onlyTheyReject.push(`${expected.id}: ${expected.error}`);
    continue;
  }
  const mismatches: Mismatch[] = [];
  compare(expected.ast, ours.ast, "", undefined, "", mismatches);
  if (mismatches.length === 0) same++;
  else different++;
  for (const it of mismatches) {
    let entry = classes.get(it.kind);
    if (!entry) classes.set(it.kind, (entry = { count: 0, inputs: new Set(), examples: [] }));
    entry.count++;
    const isNew = !entry.inputs.has(expected.id);
    entry.inputs.add(expected.id);
    const isShown = show !== undefined && it.kind.includes(show);
    if (isShown || (isNew && entry.examples.length < examples)) {
      const source: string = input.code;
      const at = it.range ? JSON.stringify(source.slice(it.range[0], Math.min(it.range[1], it.range[0] + 120))) : "";
      entry.examples.push(`${expected.id} ${it.path}\n        expected ${it.expected} actual ${it.actual}\n        ${at}`);
    }
  }
}

const ranked = [...classes].sort((a, b) => b[1].inputs.size - a[1].inputs.size);
for (const [kind, entry] of ranked) {
  if (show !== undefined && !kind.includes(show)) continue;
  console.log(`${String(entry.inputs.size).padStart(6)} inputs ${String(entry.count).padStart(7)} times  ${kind}`);
  for (const example of entry.examples) console.log(`      ${example}`);
}
if (flags.includes("--rejected")) {
  console.log(`\nonly we reject:\n${onlyWeReject.map(id => `  ${id}: ${JSON.stringify((code.get(id) ?? "").slice(0, 200))}`).join("\n")}`);
  console.log(`\nonly typescript-estree rejects:\n  ${onlyTheyReject.join("\n  ")}`);
}
if (failures.length) console.log(`\nfailures:\n  ${failures.slice(0, 50).join("\n  ")}`);
console.log(
  `\n${same} same, ${different} different in ${classes.size} classes, ${bothReject} rejected by both, ` +
    `${onlyWeReject.length} only by us, ${onlyTheyReject.length} only by typescript-estree, ${failures.length} failures`,
);
