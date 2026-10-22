function show(value: unknown): string {
  if (typeof value === "number") return Object.is(value, -0) ? "-0" : String(value);
  if (typeof value === "string") return JSON.stringify(value);
  if (typeof value === "bigint") return String(value) + "n";
  if (typeof value === "function") return "function";
  if (typeof value !== "object" || value === null) return String(value);
  const parts: string[] = [];
  if (Array.isArray(value)) {
    const list: unknown[] = value;
    if (list.length > 40) return "array of " + list.length + " with keys " + Object.keys(list).join();
    for (let i = 0; i < list.length; i++) parts.push(i in list ? show(list[i]) : "<hole>");
    return "[" + parts.join(", ") + "]";
  }
  for (const [key, member] of Object.entries(value)) parts.push(key + ": " + show(member));
  return "{" + parts.join(", ") + "}";
}

function attempt(label: string, run: () => unknown): void {
  let line: string;
  try {
    line = show(run());
  } catch (error) {
    line = "threw " + (error instanceof Error ? error.constructor.name : show(error));
  }
  console.log(label + " -> " + line);
}

type Grid = number[][];

function cell(grid: Grid, row: number, column: number): number {
  return grid[row][column];
}

function cellPlusOne(grid: Grid, row: number, column: number): number {
  return grid[row][column] + 1;
}

function neighbors(grid: Grid, row: number, column: number): number {
  let sum = 0;
  for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) if (dy !== 0 || dx !== 0) sum += grid[row + dy]?.[column + dx] ?? 0;
  return sum;
}

function neighborsInARow(grid: Grid, row: number, column: number): number {
  return grid[row][column - 1] + grid[row][column + 1];
}

function total(grid: Grid): number {
  let sum = 0;
  for (let y = 0; y < grid.length; y++) for (let x = 0; x < grid[y].length; x++) sum += grid[y][x];
  return sum;
}

function totalByTheFirstRow(grid: Grid): number {
  let sum = 0;
  for (let y = 0; y < grid.length; y++) for (let x = 0; x < grid[0].length; x++) sum += grid[y][x];
  return sum;
}

function transpose(grid: Grid): Grid {
  const out: Grid = [];
  for (let x = 0; x < grid[0].length; x++) {
    out[x] = [];
    for (let y = 0; y < grid.length; y++) out[x][y] = grid[y][x];
  }
  return out;
}

function flat(width: number, cells: number[], row: number, column: number): number {
  return cells[row * width + column];
}

const grid: Grid = [
  [1, 2, 3],
  [4, 5, 6],
];
const ragged: Grid = [[1, 2, 3], [4], []];

let warm = 0;
for (let i = 0; i < 2000; i++) warm += cell(grid, i % 2, i % 3) + cellPlusOne(grid, 1, 1) + neighbors(grid, 0, 1) + total(grid) + flat(3, [1, 2, 3, 4, 5, 6], i % 2, i % 3);
console.log("2000 honest rounds: " + warm);

attempt("a column past the end", () => [typeof cell(grid, 0, 3), cellPlusOne(grid, 0, 3)]);
attempt("column minus one", () => [typeof cell(grid, 0, -1), cellPlusOne(grid, 0, -1)]);
attempt("a row past the end", () => cell(grid, 2, 0));
attempt("row minus one", () => cell(grid, -1, 0));
attempt("row one and a half", () => cell(grid, 1.5, 0));
attempt("row minus zero", () => cell(grid, -0, -0));
attempt("neighbors at each corner", () => [neighbors(grid, 0, 0), neighbors(grid, 0, 2), neighbors(grid, 1, 0), neighbors(grid, 1, 2), neighbors(grid, 5, 5)]);
attempt("neighbors in a row", () => [neighborsInARow(grid, 0, 1), neighborsInARow(grid, 0, 0), neighborsInARow(grid, 0, 2)]);
attempt("a ragged grid", () => [total(ragged), totalByTheFirstRow(ragged)]);
attempt("a ragged grid is transposed", () => transpose(ragged));
attempt("an empty grid", () => total([]));
attempt("an empty grid by its first row", () => totalByTheFirstRow([]));
attempt("an empty grid is transposed", () => transpose([]));
attempt("rows that are holes", () => total(new Array<number[]>(2)));
attempt("a grid made by fill shares its row", () => {
  const shared: Grid = new Array<number[]>(2).fill([0, 0]);
  shared[0][1] = 5;
  return [shared, total(shared)];
});
attempt("a flat grid", () => [flat(3, [1, 2, 3, 4, 5, 6], 1, 2), typeof flat(3, [1, 2, 3, 4, 5, 6], 2, 0), flat(3, [1, 2, 3, 4, 5, 6], 0, 3), typeof flat(3, [1, 2, 3, 4, 5, 6], 0, -1), flat(3, [1, 2, 3, 4, 5, 6], 1, -1)]);
attempt("a store outside", () => {
  const small: Grid = [[1]];
  small[0][2] = 3;
  small[2] = [9];
  return [small, small.length, small[0].length];
});
attempt("a store into a row that is not there", () => {
  const small: Grid = [[1]];
  small[1][0] = 2;
  return small;
});

export {};
