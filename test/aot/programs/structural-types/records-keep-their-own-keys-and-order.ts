type Color = "red" | "green" | "blue";

function attempt(label: string, body: () => unknown): void {
  try {
    console.log(label + ": " + String(body()));
  } catch (error) {
    console.log(label + ": threw " + (error instanceof Error ? error.constructor.name : typeof error));
  }
}

function listing(o: object): string {
  const walked: string[] = [];
  for (const key in o) walked.push(key);
  return Object.keys(o).join() + " | " + walked.join() + " | " + JSON.stringify(o) + " | " + JSON.stringify({ ...o });
}

function mix(r: Record<Color, number>): number {
  return r.red * 10000 + r.green * 100 + r.blue;
}

function byKey(r: Record<Color, number>, key: Color): number {
  return r[key];
}

const declared: Record<Color, number> = { red: 1, green: 2, blue: 3 };
const backwards: Record<Color, number> = { blue: 6, green: 5, red: 4 };
const wide = { alpha: 0, blue: 9, red: 7, extra: "x", green: 8 };
const narrowed: Record<Color, number> = wide;

for (const [label, r] of [
  ["declared order", declared],
  ["backwards", backwards],
  ["with extras", narrowed],
] satisfies [string, Record<Color, number>][]) {
  console.log(label + ": " + mix(r) + " " + byKey(r, "green") + " / " + listing(r));
}

let sum = 0;
for (let i = 0; i < 2000; i++) sum += mix(declared) + byKey(declared, "blue");
console.log("2000 honest: " + sum);
console.log("then: " + mix(backwards) + " " + byKey(backwards, "blue") + " " + mix(narrowed) + " " + byKey(narrowed, "blue"));

const scores: Record<string, number> = {};
scores.zed = 1;
scores["10"] = 2;
scores.alpha = 3;
scores["2"] = 4;
scores["-1"] = 5;
scores["01"] = 6;
console.log("string keys, some like numbers: " + listing(scores));
delete scores["10"];
scores["10"] = 7;
delete scores.zed;
scores.zed = 8;
console.log("deleted and added again: " + listing(scores));

function lookup(r: Record<string, number>, key: string): string {
  const value = r[key];
  return typeof value + " " + String(typeof value === "number" ? value + 1 : "not a number");
}

for (const key of ["alpha", "missing", "constructor", "toString", "__proto__", "hasOwnProperty", "valueOf", ""]) {
  attempt("read " + JSON.stringify(key), () => lookup(scores, key));
}

const clean: Record<string, number> = Object.create(null);
clean.a = 1;
for (const key of ["a", "constructor", "__proto__"]) attempt("no prototype, read " + JSON.stringify(key), () => lookup(clean, key));
clean["__proto__"] = 5;
console.log("no prototype, __proto__ is a key: " + Object.keys(clean).join() + " " + clean["__proto__"]);

const ordinary: Record<string, number> = {};
attempt("an ordinary record, __proto__ stored", () => {
  ordinary["__proto__"] = 5;
  return Object.keys(ordinary).join() + "|" + typeof ordinary["__proto__"];
});

const fromLiteral = { a: 1, b: 2 };
const asRecord: Record<string, number> = fromLiteral;
asRecord.c = 3;
delete asRecord.a;
console.log("a literal seen as a record: " + listing(fromLiteral) + " " + typeof fromLiteral.a + " " + (fromLiteral.a + 1));

const byNumber: Record<number, string> = { 2: "two", 1: "one" };
byNumber[0.5] = "half";
byNumber[-1] = "minus";
byNumber[3] = "three";
console.log("number keys: " + listing(byNumber) + " " + byNumber[1] + " " + byNumber[0.5] + " " + typeof byNumber[7]);

const nested: Record<Color, Record<string, number>> = { green: { b: 1, a: 2 }, red: {}, blue: { z: 0 } };
console.log("records in a record: " + listing(nested));

class Table {
  cells: Record<string, number> = {};
  set(key: string, value: number): this {
    this.cells[key] = value;
    return this;
  }
  total(): number {
    let t = 0;
    for (const key in this.cells) t += this.cells[key];
    return t;
  }
}
const table = new Table().set("b", 1).set("a", 2).set("5", 3).set("b", 4);
console.log("a field: " + table.total() + " " + listing(table.cells));

export {};
