function show(value: unknown): string {
  if (typeof value === "number") return Object.is(value, -0) ? "-0" : String(value);
  if (typeof value === "string") return JSON.stringify(value);
  if (typeof value === "bigint") return String(value) + "n";
  if (typeof value === "symbol") return value.toString();
  if (typeof value === "function") return "function " + value.name;
  if (typeof value !== "object" || value === null) return String(value);
  const parts: string[] = [];
  if (Array.isArray(value)) {
    const list: unknown[] = value;
    for (let i = 0; i < list.length; i++) parts.push(i in list ? show(list[i]) : "<hole>");
    return "[" + parts.join(", ") + "]";
  }
  const entries: [string, unknown][] = Object.entries(value);
  for (const [key, member] of entries) parts.push(key + ": " + show(member));
  return (Object.getPrototypeOf(value) === null ? "no prototype" : value.constructor.name) + " {" + parts.join(", ") + "}";
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

function sum(grid: number[][]): number {
  let total = 0;
  for (let i = 0; i < grid.length; i++) {
    const row = grid[i];
    for (let j = 0; j < row.length; j++) total += row[j];
  }
  return total;
}

function sumByForOf(grid: number[][]): number {
  let total = 0;
  for (const row of grid) for (const cell of row) total += cell;
  return total;
}

function rowLengths(grid: number[][]): number[] {
  return grid.map(row => row.length);
}

function rowKinds(grid: number[][]): string[] {
  return grid.map(row => typeof row + (Array.isArray(row) ? " array" : ""));
}

function corner(grid: number[][]): number {
  return grid[grid.length - 1][0] * 2;
}

function rowSums(grid: number[][]): number[] {
  return grid.map(row => row.reduce((total, cell) => total + cell, 0));
}

function transpose(grid: number[][]): number[][] {
  const result: number[][] = [];
  for (let j = 0; j < grid[0].length; j++) {
    const column: number[] = [];
    for (let i = 0; i < grid.length; i++) column.push(grid[i][j]);
    result.push(column);
  }
  return result;
}

function make(): number[][] {
  return [[1, 2, 3], [4.5, 5.5, 6.5]];
}

let warm = 0;
for (let i = 0; i < 2000; i++) {
  const honest = make();
  warm += sum(honest) + sumByForOf(honest) + rowLengths(honest)[0] + rowKinds(honest).length + corner(honest) + rowSums(honest)[1] + transpose(honest).length;
}
console.log("after 2000 honest grids", warm);

function report(name: string, grid: number[][]): void {
  attempt(name + ": the grid", () => grid);
  attempt(name + ": sum", () => sum(grid));
  attempt(name + ": sum by for-of", () => sumByForOf(grid));
  attempt(name + ": lengths of the rows", () => rowLengths(grid));
  attempt(name + ": kinds of the rows", () => rowKinds(grid));
  attempt(name + ": corner * 2", () => corner(grid));
  attempt(name + ": sums of the rows", () => rowSums(grid));
  attempt(name + ": transposed", () => transpose(grid));
}

{
  const grid = make();
  const wide: (number[] | string)[] = grid;
  wide.push("789");
  report("a string as a row", grid);
}
{
  const grid = make();
  const wide: (number[] | string)[] = grid;
  wide[0] = "";
  report("an empty string as the first row", grid);
}
{
  const grid = make();
  const wide: (number | string)[][] = grid;
  wide.push(["7", "8", "9"]);
  report("a row of strings", grid);
}
{
  const grid = make();
  const wide: (number | string)[][] = grid;
  wide[1][1] = "x";
  report("a string in a row of doubles", grid);
}
{
  const grid = make();
  const wide: (number | string)[][] = grid;
  wide[0].push("x");
  report("a string pushed into a row of integers", grid);
}
{
  const grid = make();
  const wide: ArrayLike<number>[] = grid;
  wide.push(new Float64Array([7.5, 8.5, 9.5]));
  report("a typed array as a row", grid);
}
{
  const grid = make();
  const wide: ArrayLike<number>[] = grid;
  wide.push({ 0: 7, 1: 8, length: 3 });
  report("an array-like literal as a row", grid);
}
{
  const grid = make();
  const wide: (number[] | undefined)[] = grid;
  wide.push(undefined);
  report("undefined as a row", grid);
}
report("honest again", make());
