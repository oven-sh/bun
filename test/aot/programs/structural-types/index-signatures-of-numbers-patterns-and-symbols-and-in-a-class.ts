function text(value: unknown): string {
  if (typeof value === "number") return "number " + (Object.is(value, -0) ? "-0" : String(value));
  if (typeof value === "string") return "string " + JSON.stringify(value);
  if (typeof value === "function") return "function " + value.name;
  if (Array.isArray(value)) {
    const parts: string[] = [];
    for (let i = 0; i < value.length; i++) parts.push(i in value ? text(value[i]) : "hole");
    return "[" + parts.join(", ") + "]";
  }
  if (typeof value === "object" && value !== null) return "object " + JSON.stringify(value);
  return typeof value + " " + String(value);
}

function show(label: string, run: () => unknown): void {
  try {
    console.log(label + ": " + text(run()));
  } catch (error) {
    console.log(label + ": threw " + (error instanceof Error ? error.constructor.name : typeof error));
  }
}

interface Row {
  [column: number]: string;
}

interface Attributes {
  [name: `data-${string}`]: number;
  id: string;
}

interface Tagged {
  [tag: symbol]: number;
}

class Bag {
  [item: string]: number;
  count: number = 0;
}

class Table {
  static [name: string]: number;
  static rows: number = 2;
}

function cell(row: Row, column: number): string {
  return row[column];
}

function cellWidth(row: Row, column: number): number {
  return row[column].length;
}

function inBag(bag: Bag, item: string): number {
  return bag[item];
}

const row: Row = { 0: "a", 2: "ccc" };
show("by number: there", () => [cell(row, 0), cellWidth(row, 2)]);
show("by number: missing", () => [cell(row, 1), typeof cell(row, 1)]);
show("by number: the length of a missing one", () => cellWidth(row, 1));
show("by number: negative, a fraction, far out", () => [cell(row, -1), cell(row, 0.5), cell(row, 2 ** 32)]);
show("by number: a list under the same type", () => {
  const list: Row = ["x", "y"];
  return [cell(list, 1), cell(list, 2), cell(list, -1)];
});
show("by number: a string under the same type", () => {
  const word: Row = "hi";
  return [cell(word, 1), cell(word, 2)];
});

const attributes: Attributes = { id: "main", "data-width": 3 };
show("by a pattern: there", () => [attributes["data-width"], attributes["data-width"] + 1]);
show("by a pattern: missing", () => [attributes["data-height"], attributes["data-height"] + 1]);
show("by a pattern: a computed name", () => {
  const names: `data-${string}`[] = ["data-width", "data-depth", "data-"];
  return names.map(name => attributes[name]);
});

const mark = Symbol("mark");
const other = Symbol("other");
const tagged: Tagged = { [mark]: 1 };
show("by a symbol: there and missing", () => [tagged[mark], tagged[other], tagged[other] + 1]);
show("by a symbol: one that every object answers to", () => typeof tagged[Symbol.toStringTag]);

const bag = new Bag();
show("in a class: the field", () => [bag.count, inBag(bag, "count")]);
show("in a class: missing", () => [bag.apples, inBag(bag, "apples"), bag.apples + 1]);
bag.apples = 3;
show("in a class: after a store", () => [bag.apples, inBag(bag, "apples"), Object.keys(bag)]);
show("in a class: another instance", () => [new Bag().apples, Object.keys(new Bag())]);
show("on the static side", () => [Table.rows, Table.columns, Table.columns + 1, Object.keys(Table)]);

let sum = 0;
for (let i = 0; i < 2000; i++) sum += inBag(bag, i % 2 === 0 ? "apples" : "count") + cellWidth(row, 2);
show("2000 honest rounds", () => sum);
show("then missing ones", () => [inBag(bag, "pears"), cell(row, 7)]);
