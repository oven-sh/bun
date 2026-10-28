class Point {
  x = 1;
  y = 2;
  label?: string;
  sum(): number {
    return this.x + this.y;
  }
}
interface Row {
  id: number;
  name: string;
  note?: string;
}
function makeRow(id: number): Row {
  return { id, name: "row" + id };
}
function attempt(name: string, run: () => unknown): void {
  try {
    console.log(name + ":", run());
  } catch (error) {
    console.log(name + ":", "throws", (error as Error).name);
  }
}
function define(target: any, key: string, descriptor: PropertyDescriptor): void {
  Object.defineProperty(target, key, descriptor);
}
function describe(target: any, key: string): string {
  const found = Object.getOwnPropertyDescriptor(target, key);
  return found ? [found.value, found.writable, found.enumerable, found.configurable].join("|") : "none";
}
function keysByLoop(target: object): string {
  const keys: string[] = [];
  for (const key in target) keys.push(key);
  return keys.join();
}
function seen(target: Point | Row): string {
  return [
    Object.keys(target).join(),
    keysByLoop(target),
    JSON.stringify(target),
    Object.keys({ ...target }).join(),
    Object.keys(Object.assign({}, target)).join(),
    Object.entries(target).join(";"),
    Object.values(target).join(),
    Object.getOwnPropertyNames(target).join(),
    Reflect.ownKeys(target).join(),
  ].join(" / ");
}

attempt("a hidden optional field", () => {
  const row = makeRow(2);
  row.note = "n";
  define(row, "note", { enumerable: false });
  return seen(row) + " / " + describe(row, "note") + " / " + row.note;
});
attempt("an optional field born hidden", () => {
  const row = makeRow(3);
  define(row, "note", { value: "born", writable: true, configurable: true, enumerable: false });
  return seen(row) + " / " + describe(row, "note") + " / " + row.note;
});
attempt("a field that is not configurable", () => {
  const point = new Point();
  define(point, "x", { configurable: false });
  point.x = 5;
  return seen(point) + " / " + describe(point, "x") + " / " + point.sum();
});
attempt("a field that is not configurable is deleted by untyped code", () => {
  "use strict";
  const row = makeRow(4);
  row.note = "kept";
  define(row, "note", { configurable: false });
  const any: any = row;
  let outcome = "";
  try {
    outcome = String(delete any.note);
  } catch (error) {
    outcome = (error as Error).name;
  }
  return outcome + " / " + row.note + " / " + describe(row, "note");
});
attempt("a field that is not configurable is deleted by typed code", () => {
  const row = makeRow(5);
  row.note = "kept";
  define(row, "note", { configurable: false });
  let outcome = "";
  try {
    outcome = String(delete row.note);
  } catch (error) {
    outcome = (error as Error).name;
  }
  return outcome + " / " + row.note + " / " + describe(row, "note");
});
attempt("a field that is not configurable is redefined", () => {
  const point = new Point();
  define(point, "x", { configurable: false });
  let outcome = "";
  try {
    define(point, "x", { enumerable: false });
    outcome = "redefined";
  } catch (error) {
    outcome = (error as Error).name;
  }
  return outcome + " / " + describe(point, "x") + " / " + Reflect.defineProperty(point, "x", { configurable: true });
});
attempt("sealed or frozen, asked", () => {
  const point = new Point();
  define(point, "x", { configurable: false });
  define(point, "y", { configurable: false });
  return [Object.isSealed(point), Object.isFrozen(point), Object.isExtensible(point)].join();
});
attempt("a hidden optional field is stored to and shown again", () => {
  const row = makeRow(7);
  row.note = "first";
  define(row, "note", { enumerable: false });
  row.note = "second";
  const hidden = seen(row) + " / " + describe(row, "note");
  define(row, "note", { enumerable: true });
  return hidden + " // " + seen(row) + " / " + describe(row, "note");
});
attempt("a copy lacks the hidden optional field", () => {
  const row = makeRow(8);
  row.note = "n";
  define(row, "note", { enumerable: false, configurable: false });
  const copy: Row = { ...row };
  return seen(copy) + " / " + describe(copy, "note") + " / " + copy.note + " / " + copy.id + " / " + structuredClone(row).name;
});
attempt("one object of many", () => {
  const rows = [makeRow(1), makeRow(2), makeRow(3)];
  for (const row of rows) row.note = "n" + row.id;
  define(rows[1], "note", { enumerable: false });
  return rows.map((row) => Object.keys(row).join("") + JSON.stringify(row) + row.note).join(" ");
});
attempt("in a loop that is hot", () => {
  const row = makeRow(9);
  row.note = "n";
  let total = 0;
  for (let i = 0; i < 2000; i++) {
    if (i === 1000) define(row, "note", { enumerable: false });
    total += Object.keys(row).length + row.id + (row.note as string).length;
  }
  return total;
});
