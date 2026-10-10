// Compares what `dump.ts` printed with what `bun-lint semantic dump --batch` printed for the same cases.
//
//   bun compare.ts cases.jsonl expected.jsonl actual.jsonl [--show=n] [--only=scopes|variables|references|declared|implicit] [--grep=text]
//
// Prints a summary ranked by the kind of difference, and the first `n` cases of each kind.

import { readFileSync } from "node:fs";

const flags = process.argv.slice(2).filter(it => it.startsWith("--"));
const [casesPath, expectedPath, actualPath] = process.argv.slice(2).filter(it => !it.startsWith("--"));
const flag = (name: string) => flags.find(it => it.startsWith(`--${name}=`))?.slice(name.length + 3);
const show = Number(flag("show") ?? 2);
const only = flag("only");
const grep = flag("grep");

const read = (path: string) =>
  readFileSync(path, "utf8")
    .split("\n")
    .filter(Boolean)
    .map(line => JSON.parse(line));
const cases = new Map(read(casesPath).map(it => [it.id, it]));
const actual = new Map(read(actualPath).map(it => [it.id, it]));

const isTopLevel = (row: unknown[]) =>
  row[1] === 0 && (row[0] === "global" || row[0] === "module" || (row[0] === "function" && row[4] === "global@0"));

/// Rows as strings, in an order that does not depend on the order of traversal.
function normalize(part: string, rows: unknown[][]): string[] {
  const texts = rows.map(row => {
    // Parsers disagree on where a program ends.
    if (part === "scopes" && isTopLevel(row)) row = row.with(2, null);
    return JSON.stringify(row);
  });
  // References at one place stay in order: the order of the values that are written is significant.
  if (part === "references") {
    return rows
      .map((row, i) => [row[0] as number, i] as const)
      .sort((a, b) => a[0] - b[0] || a[1] - b[1])
      .map(([, i]) => texts[i]);
  }
  return texts.sort();
}

/// The two syntax trees do not have the same nodes. For each range that is a node in both: the scopes of the nodes with that
/// range.
function commonNodes(a: [number, number, string][], b: [number, number, string][]) {
  const byRange = (rows: [number, number, string][]) => {
    const map = new Map<string, Set<string>>();
    for (const [start, end, scope] of rows) {
      const key = `${start}-${end}`;
      if (!map.has(key)) map.set(key, new Set());
      map.get(key)!.add(scope);
    }
    return map;
  };
  const [inA, inB] = [byRange(a), byRange(b)];
  const rows = (map: Map<string, Set<string>>, other: Map<string, Set<string>>) =>
    [...map].filter(([key]) => other.has(key)).map(([key, scopes]) => [key, [...scopes].sort().join(" ")]);
  return [rows(inA, inB), rows(inB, inA)];
}

/// What a difference is about, to group by.
function classify(part: string, missing: string[], extra: string[]): string {
  const describe = (text: string) => {
    const row = JSON.parse(text);
    if (part === "scopes") return row[0];
    if (part === "variables") return `${row[3].join("+") || "implicit"} in ${String(row[1]).split("@")[0]}`;
    if (part === "references") return `${row[2]}${row[3]}${row[4] ? "i" : ""}`;
    return "";
  };
  if (missing.length && extra.length && missing.length === extra.length) {
    const [a, b] = [JSON.parse(missing[0]), JSON.parse(extra[0])];
    const columns = a
      .map((_: unknown, i: number) => i)
      .filter((i: number) => JSON.stringify(a[i]) !== JSON.stringify(b[i]));
    return `${part}: column ${columns.join(",")} differs (${describe(missing[0])})`;
  }
  if (missing.length) return `${part}: missing ${describe(missing[0])}`;
  return `${part}: extra ${describe(extra[0])}`;
}

const kinds = new Map<string, { count: number; examples: string[] }>();
let [same, different, skippedByThem, skippedByUs, panicked] = [0, 0, 0, 0, 0];
for (const theirs of read(expectedPath)) {
  const ours = actual.get(theirs.id);
  const it = cases.get(theirs.id);
  if (grep && !it.code.includes(grep)) continue;
  if (theirs.error) {
    skippedByThem++;
    continue;
  }
  if (!ours || ours.error) {
    if (ours?.error === "panicked") {
      panicked++;
      console.log(`PANIC in case ${theirs.id} (${it.filename}):\n${it.code.slice(0, 400)}\n`);
    }
    skippedByUs++;
    continue;
  }
  let isSame = true;
  // Where `Expr::symbol` is not the value that the reference resolves to: nowhere.
  theirs.shortcut = [];
  for (const part of ["scopes", "variables", "references", "declared", "implicit", "shortcut", "nodes"]) {
    if ((only && only !== part) || !ours[part]) continue;
    if (!theirs[part]) continue;
    if (part === "nodes") [theirs.nodes, ours.nodes] = commonNodes(theirs.nodes, ours.nodes);
    const [a, b] = [normalize(part, theirs[part]), normalize(part, ours[part])];
    if (a.join("\n") === b.join("\n")) continue;
    isSame = false;
    const count = (list: string[]) => {
      const counts = new Map<string, number>();
      for (const text of list) counts.set(text, (counts.get(text) ?? 0) + 1);
      return counts;
    };
    const [inA, inB] = [count(a), count(b)];
    const missing = a.filter(text => (inB.get(text) ?? 0) < inA.get(text)!);
    const extra = b.filter(text => (inA.get(text) ?? 0) < inB.get(text)!);
    const kind = missing.length || extra.length ? classify(part, missing, extra) : `${part}: order`;
    const entry = kinds.get(kind) ?? { count: 0, examples: [] };
    entry.count++;
    if (entry.examples.length < show) {
      const { id, code, ...options } = it;
      entry.examples.push(
        `── case ${id} ${JSON.stringify(options)}\n${code.length > 1500 ? code.slice(0, 1500) + "…" : code}\n` +
          missing
            .slice(0, 6)
            .map(text => `  - ${text}\n`)
            .join("") +
          extra
            .slice(0, 6)
            .map(text => `  + ${text}\n`)
            .join(""),
      );
    }
    kinds.set(kind, entry);
    break;
  }
  if (isSame) same++;
  else different++;
}

const ranked = [...kinds].sort((a, b) => b[1].count - a[1].count);
for (const [kind, { count, examples }] of [...ranked].reverse()) {
  if (show > 0) console.log(`\n════ ${count} × ${kind}\n${examples.join("\n")}`);
}
console.log("\nsummary");
for (const [kind, { count }] of ranked) console.log(`${String(count).padStart(6)}  ${kind}`);
console.log(
  `\n${same} same, ${different} different, ${skippedByThem} that ESLint's parser rejects, ${skippedByUs} that ours rejects (${panicked} panics)`,
);
