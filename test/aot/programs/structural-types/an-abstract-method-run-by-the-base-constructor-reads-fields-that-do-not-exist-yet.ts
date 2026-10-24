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

abstract class Model {
  abstract size(): number;
  abstract label(): string;
  abstract fill(): void;
  sizeAtStart: number;
  labelAtStart: string;
  constructor() {
    this.sizeAtStart = this.size();
    this.labelAtStart = this.label();
    this.fill();
  }
}

class Grid extends Model {
  columns: number = 3;
  rows: number = 2;
  caption: string = "grid";
  cells: number[] = [];
  size(): number {
    return this.columns * this.rows;
  }
  label(): string {
    return this.caption + " " + this.columns;
  }
  fill(): void {
    this.rows = 50;
    this.caption = "filled early";
  }
}

class Constant extends Model {
  size(): number {
    return 7;
  }
  label(): string {
    return "constant";
  }
  fill(): void {}
}

class Pushes extends Model {
  cells: number[] = [];
  size(): number {
    return 0;
  }
  label(): string {
    return "pushes";
  }
  fill(): void {
    this.cells.push(1);
  }
}

function startOf(model: Model): number {
  return model.sizeAtStart;
}

let sum = 0;
for (let i = 0; i < 2000; i++) sum += startOf(new Constant()) + new Constant().labelAtStart.length;
show("2000 that need no field", () => sum);

const grid = new Grid();
show("the size at the start", () => [grid.sizeAtStart, typeof grid.sizeAtStart, startOf(grid), startOf(grid) + 1]);
show("the label at the start", () => [grid.labelAtStart, grid.labelAtStart.length]);
show("the size now", () => grid.size());
show("the label now", () => grid.label());
show("what the early stores left", () => [grid.rows, grid.caption]);
show("keys", () => Object.keys(grid));
show("JSON", () => JSON.stringify(grid));
show("one that pushes into a list that is not there", () => new Pushes());
show("the constant one", () => [startOf(new Constant()), new Constant().labelAtStart, Object.keys(new Constant())]);
show("three in a row", () => [new Constant(), new Grid(), new Constant()].map(startOf));
