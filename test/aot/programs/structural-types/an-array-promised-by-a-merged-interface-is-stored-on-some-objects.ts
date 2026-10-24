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
}
class Shelf {
  id: number;
  constructor(id: number) {
    this.id = id;
  }
  count(): number {
    return this.rows.length;
  }
  add(n: number): number {
    return this.rows.push(n);
  }
}

function filled(id: number): Shelf {
  const shelf = new Shelf(id);
  shelf.rows = [id, id + 1];
  return shelf;
}

function rowsOf(shelf: Shelf): number[] {
  return shelf.rows;
}

function firstOf(shelf: Shelf): number {
  return shelf.rows[0];
}

function sumOf(shelf: Shelf): number {
  let sum = 0;
  for (const row of shelf.rows) sum += row;
  return sum;
}

show("the first call gets one without it", () => rowsOf(new Shelf(1)));
show("its first row", () => firstOf(new Shelf(1)));

let sum = 0;
for (let i = 0; i < 2000; i++) sum += firstOf(filled(i)) + sumOf(filled(i)) + rowsOf(filled(i)).length + filled(i).count() + filled(i).add(1);
show("2000 with it", () => sum);
show("one without it", () => rowsOf(new Shelf(5)));
show("its first row", () => firstOf(new Shelf(5)));
show("its sum", () => sumOf(new Shelf(5)));
show("its count", () => new Shelf(5).count());
show("a push into it", () => new Shelf(5).add(1));
show("one with it again", () => [rowsOf(filled(1)), firstOf(filled(1)), sumOf(filled(1)), filled(1).count()]);
show("all rows in one list", () => [filled(1), new Shelf(2), filled(3)].flatMap(rowsOf));
show("keys of both", () => [Object.keys(filled(1)), Object.keys(new Shelf(1))]);
show("JSON of both", () => JSON.stringify([filled(1), new Shelf(1)]));

const late = new Shelf(1);
show("before the store", () => [late.rows, "rows" in late]);
late.rows = [];
show("after the store", () => [late.rows, late.count(), late.add(7), late.rows, firstOf(late)]);
const kept = new Shelf(1);
show("??= where there is nothing", () => (kept.rows ??= [9]));
show("after it", () => [kept.rows, kept.count()]);
