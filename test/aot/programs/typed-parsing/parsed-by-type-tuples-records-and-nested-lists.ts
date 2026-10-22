function show(value: unknown): string {
  if (typeof value === "number") return Object.is(value, -0) ? "-0" : String(value);
  if (typeof value === "string") return JSON.stringify(value);
  if (typeof value === "bigint") return value + "n";
  if (typeof value === "function") return "function";
  if (typeof value !== "object" || value === null) return String(value);
  if (Array.isArray(value)) {
    const parts: string[] = [];
    for (let i = 0; i < value.length; i++) parts.push(i in value ? show(value[i]) : "hole");
    return "[" + parts.join(", ") + "]";
  }
  const parent = Object.getPrototypeOf(value);
  const mark = parent === Object.prototype ? "" : parent === null ? "without a prototype " : "with another prototype ";
  return mark + "{" + Object.entries(value).map(([key, held]) => JSON.stringify(key) + ": " + show(held)).join(", ") + "}";
}

function attempt(label: string, run: () => unknown): void {
  try {
    console.log(label, "->", show(run()));
  } catch (error) {
    console.log(label, "threw", error instanceof Error ? error.constructor.name : typeof error);
  }
}

type Pair = [number, string];
type Grid = number[][];
type Rows = { cells: [number, number]; label: string }[];
type Table = Record<string, { count: number }>;
type Fixed = Record<"a" | "b", number>;

function swap(pair: Pair): [string, number] {
  return [pair[1], pair[0]];
}
function sumGrid(grid: Grid): number {
  let sum = 0;
  for (const row of grid) for (const cell of row) sum += cell;
  return sum;
}
function widths(rows: Rows): number[] {
  return rows.map(row => row.cells[1] - row.cells[0]);
}
function counts(table: Table): number {
  let sum = 0;
  for (const key of Object.keys(table)) sum += table[key].count;
  return sum;
}

attempt("a pair", () => {
  const pair = JSON.parse<Pair>('[1,"one"]');
  return [pair, pair.length, swap(pair), Array.isArray(pair), pair[0] + 1, pair[1].length];
});
attempt("a pair that is pushed to", () => {
  const pair = JSON.parse<Pair>('[1,"one"]');
  pair.push(2, "two");
  return [pair, pair.length, swap(pair)];
});
attempt("an empty tuple", () => JSON.parse<[]>("[]"));
attempt("a grid", () => {
  const grid = JSON.parse<Grid>("[[1,2],[],[3.5],[-0],[1e21]]");
  return [grid, sumGrid(grid), grid[1].length, grid[3][0]];
});
attempt("rows", () => {
  const rows = JSON.parse<Rows>('[{"cells":[1,5],"label":"a"},{"label":"b","cells":[0.5,0.25]},{"cells":[2,2],"label":"c","more":[]}]');
  return [rows, widths(rows), rows.map(row => row.label).join()];
});
attempt("a table", () => {
  const table = JSON.parse<Table>('{"x":{"count":1},"y":{"count":2,"more":true},"":{"count":3},"constructor":{"count":4}}');
  const name: string = "constructor";
  return [table, counts(table), Object.keys(table), table[name].count, table["missing"]];
});
attempt("an empty table", () => {
  const table = JSON.parse<Table>("{}");
  const name: string = "toString";
  return [table, counts(table), table[name] === undefined, typeof table[name]];
});
attempt("fixed keys", () => {
  const fixed = JSON.parse<Fixed>('{"b":2,"c":3,"a":1}');
  return [fixed, fixed.a + fixed.b, Object.keys(fixed)];
});
attempt("read-only lists", () => {
  const list = JSON.parse<readonly number[]>("[3,1,2]");
  const pair = JSON.parse<readonly [number, number]>("[1,2]");
  return [list, list.toSorted(), pair, Object.isFrozen(list), Object.isFrozen(pair)];
});
