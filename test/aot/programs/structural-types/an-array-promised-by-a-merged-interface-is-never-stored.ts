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

interface Shelf {
  rows: number[];
  names: string[];
}
class Shelf {
  id: number = 1;
  count(): number {
    return this.rows.length;
  }
  sum(): number {
    let sum = 0;
    for (const row of this.rows) sum += row;
    return sum;
  }
}

function total(list: number[]): number {
  let sum = 0;
  for (let i = 0; i < list.length; i++) sum += list[i];
  return sum;
}

function rowsOf(shelf: Shelf): number[] {
  return shelf.rows;
}

show("an honest caller", () => total([1, 2, 3]));

const shelf = new Shelf();
show("read", () => shelf.rows);
show("typeof", () => typeof shelf.rows);
show("Array.isArray", () => Array.isArray(shelf.rows));
show("equals undefined", () => shelf.rows === undefined);
show("as a condition", () => (shelf.rows ? "yes" : "no"));
show("length", () => shelf.rows.length);
show("length if there", () => shelf.rows?.length);
show("first element", () => shelf.rows[0]);
show("first element if there", () => shelf.rows?.[0]);
show("a store to an element", () => (shelf.rows[0] = 1));
show("push", () => shelf.rows.push(1));
show("map", () => shelf.rows.map(n => n + 1));
show("join", () => shelf.names.join());
show("for of", () => {
  let sum = 0;
  for (const row of shelf.rows) sum += row;
  return sum;
});
show("for in", () => {
  const keys: string[] = [];
  for (const key in shelf.rows) keys.push(key);
  return keys;
});
show("spread into a list", () => [...shelf.rows]);
show("spread into a call", () => Math.max(...shelf.rows));
show("spread into an object", () => ({ ...shelf.rows }));
show("taken apart", () => {
  const [first] = shelf.rows;
  return first;
});
show("Array.from", () => Array.from(shelf.rows));
show("concat as an argument", () => {
  const none: number[] = [];
  return none.concat(shelf.rows);
});
show("or an empty list", () => (shelf.rows ?? []).length);
show("in a method", () => shelf.count());
show("in a looping method", () => shelf.sum());
show("through a function", () => rowsOf(shelf));
show("given to a typed function", () => total(shelf.rows));
show("a typed local", () => {
  const rows: number[] = shelf.rows;
  return rows;
});
show("a typed element", () => {
  const table: number[][] = [shelf.rows, [1]];
  return table;
});
show("JSON of it", () => JSON.stringify(shelf.rows));
show("in", () => "rows" in shelf);
show("keys", () => Object.keys(shelf));
show("JSON", () => JSON.stringify(shelf));
show("an honest caller again", () => total([1, 2, 3]));
