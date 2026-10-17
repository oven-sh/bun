interface Row {
  id: number;
  name: string;
  next: Row | null;
}

const untyped: any = {
  redefine(row: any) {
    Object.defineProperty(row, "id", { get: () => 1000, configurable: true, enumerable: true });
  },
  remove(row: any) {
    delete row.name;
    row.name = "again";
  },
  misfit(row: any) {
    row.id = 2000;
    delete row.next;
    row.next = null;
    Object.defineProperty(row, "name", { value: "fixed", writable: false, configurable: true, enumerable: true });
  },
};

function make(id: number): Row {
  return { id, name: "n" + id, next: null };
}

const seen: any[] = [];
function share(row: Row): Row {
  seen.push(row);
  return row;
}

function acrossCall(row: Row, change: (row: Row) => void): string {
  const before = row.id + row.name.length;
  change(row);
  return before + " " + row.id + " " + row.name;
}

function acrossAddition(row: Row, other: any): string {
  const before = row.id;
  const sum = other + 1;
  return before + " " + sum + " " + row.id + " " + row.name;
}

function acrossComparison(row: Row, other: any): string {
  const before = row.id;
  const less = other < 5;
  return before + " " + less + " " + row.id + " " + row.name;
}

function acrossGetter(row: Row, other: any): string {
  const before = row.id;
  const got = other.value;
  return before + " " + got + " " + row.id + " " + row.name;
}

function acrossSetter(row: Row, other: any): string {
  const before = row.id;
  other.value = 3;
  return before + " " + row.id + " " + row.name;
}

function acrossText(row: Row, other: any): string {
  const before = row.id;
  const text = `${other}`;
  return before + " " + text + " " + row.id + " " + row.name;
}

function acrossIn(row: Row, other: any): string {
  const before = row.id;
  const has = "key" in other;
  return before + " " + has + " " + row.id + " " + row.name;
}

function acrossInstanceOf(row: Row, other: any): string {
  const before = row.id;
  const is = row instanceof other;
  return before + " " + is + " " + row.id + " " + row.name;
}

function acrossIteration(row: Row, other: any): string {
  const before = row.id;
  let total = 0;
  for (const value of other) total += value + row.id;
  return before + " " + total + " " + row.id + " " + row.name;
}

function acrossElement(row: Row, other: any, key: any): string {
  const before = row.id;
  const got = other[key];
  return before + " " + got + " " + row.id + " " + row.name;
}

function acrossStranger(row: Row, stranger: Row): string {
  const before = row.id;
  const got = stranger.id;
  return before + " " + got + " " + row.id + " " + row.name;
}

function acrossLoop(row: Row, change: (row: Row) => void): string {
  let total = 0;
  for (let i = 0; i < 4; i++) {
    total += row.id;
    if (i === 1) change(row);
  }
  return total + " " + row.name;
}

function acrossStore(row: Row, other: Row): string {
  const before = row.id;
  other.id = 7;
  other.name = "stored";
  return before + " " + row.id + " " + row.name;
}

const changes = [untyped.redefine, untyped.remove, untyped.misfit];
for (const change of changes) {
  const doing = (row: Row) => change(row);
  const fresh = () => share(make(1));
  let row = fresh();
  console.log("call", acrossCall(row, doing));
  row = fresh();
  console.log("addition", acrossAddition(row, { valueOf: () => (change(row), 10) }));
  row = fresh();
  console.log("comparison", acrossComparison(row, { valueOf: () => (change(row), 10) }));
  row = fresh();
  console.log("getter", acrossGetter(row, { get value() { change(row); return "got"; } }));
  row = fresh();
  console.log("setter", acrossSetter(row, { set value(_: number) { change(row); } }));
  row = fresh();
  console.log("text", acrossText(row, { toString: () => (change(row), "text") }));
  row = fresh();
  console.log("in", acrossIn(row, new Proxy({}, { has: () => (change(row), true) })));
  row = fresh();
  console.log("instanceof", acrossInstanceOf(row, { [Symbol.hasInstance]: () => (change(row), true) }));
  row = fresh();
  console.log("iteration", acrossIteration(row, { *[Symbol.iterator]() { yield 1; change(row); yield 2; } }));
  row = fresh();
  console.log("element", acrossElement(row, new Proxy({}, { get: () => (change(row), "element") }), "k"));
  row = fresh();
  console.log("key", acrossElement(row, { k: "by key" }, { toString: () => (change(row), "k") }));
  row = fresh();
  const stranger: any = { get id() { change(row); return 5; }, name: "s", next: null };
  console.log("stranger", acrossStranger(row, stranger));
  row = fresh();
  console.log("loop", acrossLoop(row, doing));
  row = fresh();
  console.log("store", acrossStore(row, row));
}

console.log(seen.length);
