// A key is put together in one place and used in others: looked up on one branch and handed on in the other, used again behind a join, inside a loop that the key stands outside of, in a closure, returned, thrown, caught; and the table may be one that nothing proves to be a plain Map or Set. The string has to be the same everywhere, however late it is made.
const report: string[] = [];
let wrong = 0;

class Account {
  constructor(readonly owner: string, readonly label: string) {}
}
const ledger = new Map<string, Account>();
const archive: Record<string, Account> = {};
function open(owner: string, year: number, archived: boolean): Account {
  const label = owner + "@" + year;
  if (archived) {
    const old = archive[label];
    return old ?? (archive[label] = new Account(owner, label));
  }
  const held = ledger.get(label);
  if (held) return held;
  const fresh = new Account(owner, label);
  ledger.set(label, fresh);
  return fresh;
}
for (let turn = 0; turn < 3; turn++)
  for (const owner of ["ann", "bo", "", "zoë", "Женя"])
    for (let year = 1998; year < 2040; year += 7) {
      const live = open(owner, year, false);
      const stored = open(owner, year, true);
      if (live.label !== stored.label || live.label !== [owner, year].join("@") || live === (stored as unknown)) wrong++;
      if (open(owner, year, false) !== live || open(owner, year, true) !== stored) wrong++;
    }
report.push("branches " + ledger.size + " " + Object.keys(archive).length);

function afterAJoin(table: Map<string, number>, stem: string, n: number): string {
  const label = stem + "-" + n;
  let value: number;
  if (n % 3 === 0) value = label.length;
  else value = table.get(label) ?? -1;
  if (n % 2 === 0) table.set(label, value + 1);
  return n % 5 === 0 ? label + ">" + value : "";
}
{
  const table = new Map<string, number>();
  let text = "";
  for (let turn = 0; turn < 2; turn++) for (let n = 0; n < 31; n++) text += afterAJoin(table, turn ? "s" : "stem", n % 16);
  report.push("join " + table.size + " " + text);
}

function outsideTheLoop(table: Map<string, number>, stem: string, n: number): string {
  const label = `${stem}[${n}]`;
  let sum = 0;
  for (let i = 0; i < 6; i++) {
    sum += table.get(label) ?? 1;
    if (i === 2) table.set(label, 10);
    if (i === 4) table.delete(label);
  }
  const copies: string[] = [];
  while (copies.length < 2) copies.push(label);
  return sum + copies.join("");
}
report.push("loop " + outsideTheLoop(new Map(), "q", 4) + " " + outsideTheLoop(new Map([["q[4]", 3]]), "q", 4));

function later(group: Set<string>, stem: string, n: number): () => string {
  const label = stem + "/" + n;
  if (group.has(label)) return () => "again " + label;
  group.add(label);
  return () => "first " + label;
}
{
  const group = new Set<string>();
  report.push("closure " + [later(group, "c", 1), later(group, "c", 2), later(group, "c", 1)].map(say => say()).join(", "));
}

function itself(table: Map<string, string>, stem: string, n: number): string {
  const label = stem + "*" + n;
  const held = table.get(label);
  if (held !== undefined) return held + "'";
  table.set(label, label);
  return label;
}
{
  const table = new Map<string, string>();
  report.push("returned " + itself(table, "r", 9) + " " + itself(table, "r", 9) + " " + itself(table, "", -1) + " " + table.size);
}

function orThrow(table: Map<string, number>, stem: string, n: number): number {
  const label = stem + "!" + n;
  const held = table.get(label);
  if (held === undefined) throw label;
  return held;
}
function insideTry(table: Map<string, number>, stems: string[]): string {
  let failures = 0;
  let last = "";
  for (let i = 0; i < stems.length; i++) {
    try {
      const label = stems[i]! + "?" + (i % 4);
      const held = table.get(label);
      if (i % 5 === 2) throw new TypeError(label);
      table.set(label, held === undefined ? i : held - i);
    } catch (problem) {
      failures++;
      last = (problem as Error).message;
    }
  }
  return failures + " " + last + " " + table.size;
}
{
  const table = new Map<string, number>([["t!1", 8]]);
  const said: string[] = [];
  for (const n of [1, 2, 1]) {
    try {
      said.push(String(orThrow(table, "t", n)));
    } catch (label) {
      said.push("no " + label);
    }
  }
  report.push("thrown " + said.join(", ") + " | " + insideTry(new Map(), ["a", "b", "a", "c", "a", "b", "a", "d", "a", "b", "c", "a", "b"]));
}

class Folding extends Map<string, number> {
  asked = 0;
  get(label: string): number | undefined {
    this.asked++;
    return super.get(label.toLowerCase());
  }
  set(label: string, value: number): this {
    return super.set(label.toLowerCase(), value);
  }
}
type Shelf = { counts: Map<string, number>; present: Set<string> };
function onAnyShelf(shelves: Shelf[], stems: string[]): string {
  for (let i = 0; i < stems.length * 3; i++) {
    const shelf = shelves[i % shelves.length]!;
    const label = stems[i % stems.length]! + "_" + stems[(i * 2 + 1) % stems.length]!;
    const times = shelf.counts.get(label);
    shelf.counts.set(label, times === undefined ? 1 : times + 1);
    if (!shelf.present.has(label)) shelf.present.add(label);
  }
  return shelves.map(shelf => shelf.counts.size + "," + shelf.present.size + "," + [...shelf.counts].slice(0, 2).join("+")).join(" ");
}
{
  const folding = new Folding();
  report.push("any table " + onAnyShelf([{ counts: new Map(), present: new Set() }, { counts: folding, present: new Set() }], ["Ab", "aB", "cd", "CD", "e"]) + " " + folding.asked);
}

class Halving extends Map<number, number> {
  get(key: number): number | undefined {
    const held = super.get(key);
    if (key % 4 === 0) super.delete(key);
    return held === undefined ? undefined : held / 2;
  }
}
function numbersOnAnyTable(tables: Map<number, number>[], keys: number[]): string {
  let sum = 0;
  for (let turn = 0; turn < 3; turn++)
    for (let i = 0; i < keys.length; i++) {
      const table = tables[(i + turn) % tables.length]!;
      const key = keys[i]!;
      if (table.has(key)) sum += table.get(key)!;
      else table.set(key, i + 1);
      const half = table.get(key + 0.5);
      table.set(key + 0.5, half === undefined ? 1 : half + 1);
    }
  return sum + " " + tables.map(table => table.size).join();
}
report.push("numbers " + numbersOnAnyTable([new Map(), new Halving()], [8, 3, 12, 3, 8, 5, 16, 12, 1]), "wrong " + wrong);
console.log(report.join("\n"));
