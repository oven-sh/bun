function show(value: unknown): string {
  if (typeof value === "number") return Object.is(value, -0) ? "-0" : String(value);
  if (typeof value === "string") return JSON.stringify(value);
  if (typeof value === "bigint") return value + "n";
  if (value === null || value === undefined) return String(value);
  if (typeof value === "boolean") return String(value);
  if (Array.isArray(value)) {
    const parts: string[] = [];
    for (let i = 0; i < value.length; i++) parts.push(i in value ? show(value[i]) : "hole");
    return "[" + parts.join(", ") + "]";
  }
  return typeof value;
}

const log: string[] = [];

function attempt(label: string, run: () => unknown): void {
  log.length = 0;
  try {
    console.log(label, "->", show(run()), log.join(" "));
  } catch (error) {
    console.log(label, "threw", error instanceof Error ? error.constructor.name : typeof error, log.join(" "));
  }
}

interface Cell {
  value: number | string;
  next: Cell | null;
  run?: () => number;
}

function toText(c: Cell): void {
  c.value = "text";
}

function cut(c: Cell): void {
  c.next = null;
}

function disarm(c: Cell): void {
  delete c.run;
}

const nothing = (c: Cell): void => {};

function double(c: Cell, between: (c: Cell) => void): number {
  if (typeof c.value === "number") {
    between(c);
    return c.value * 2;
  }
  return -1;
}

function fixed(c: Cell, between: (c: Cell) => void): string {
  if (typeof c.value === "number") {
    between(c);
    return c.value.toFixed(1);
  }
  return "text already";
}

function added(c: Cell, between: (c: Cell) => void): number {
  if (typeof c.value === "number") {
    between(c);
    const n: number = c.value;
    return n + 1;
  }
  return -1;
}

function following(c: Cell, between: (c: Cell) => void): number | string {
  if (c.next !== null) {
    between(c);
    return c.next.value;
  }
  return "no next";
}

function called(c: Cell, between: (c: Cell) => void): number {
  if (c.run !== undefined) {
    between(c);
    return c.run() + 1;
  }
  return -1;
}

function calledIfTruthy(c: Cell, between: (c: Cell) => void): number {
  if (c.run) {
    between(c);
    return c.run();
  }
  return -1;
}

class Owner {
  cell: Cell = { value: 1, next: null };
  spoil(): void {
    this.cell.value = "spoiled";
  }
  replace(): void {
    this.cell = { value: "replaced", next: null };
  }
  viaMethod(change: boolean): number {
    if (typeof this.cell.value === "number") {
      if (change) this.spoil();
      return this.cell.value + 1;
    }
    return -1;
  }
  viaReplacement(change: boolean): number {
    if (typeof this.cell.value === "number") {
      if (change) this.replace();
      return this.cell.value + 1;
    }
    return -1;
  }
}

const make = (): Cell => ({ value: 4, next: { value: 5, next: null }, run: () => 6 });

function everything(label: string, value: (c: Cell) => void, next: (c: Cell) => void, run: (c: Cell) => void, change: boolean): void {
  attempt(label + " double", () => double(make(), value));
  attempt(label + " fixed", () => fixed(make(), value));
  attempt(label + " added", () => added(make(), value));
  attempt(label + " following", () => following(make(), next));
  attempt(label + " called", () => called(make(), run));
  attempt(label + " calledIfTruthy", () => calledIfTruthy(make(), run));
  attempt(label + " via a method", () => new Owner().viaMethod(change));
  attempt(label + " via a replacement", () => new Owner().viaReplacement(change));
}

everything("honest", nothing, nothing, nothing, false);
let warm = 0;
for (let i = 0; i < 2000; i++) warm += double(make(), nothing) + fixed(make(), nothing).length + added(make(), nothing) + called(make(), nothing) + new Owner().viaMethod(false);
console.log("2000 honest rounds", warm);
everything("changed", toText, cut, disarm, true);
everything("honest again", nothing, nothing, nothing, false);

attempt("an element of an array", () => {
  const cells: Cell[] = [make()];
  if (typeof cells[0].value === "number") {
    toText(cells[0]);
    return cells[0].value + 1;
  }
  return -1;
});
attempt("an element replaced", () => {
  const cells: Cell[] = [make()];
  const swap = () => {
    cells[0] = { value: "swapped", next: null };
  };
  if (typeof cells[0].value === "number") {
    swap();
    return cells[0].value + 1;
  }
  return -1;
});
attempt("a callback of a built-in in between", () => {
  const c = make();
  if (typeof c.value === "number") {
    [1].forEach(() => toText(c));
    return c.value + 1;
  }
  return -1;
});
attempt("a template in between calls toString", () => {
  const c = make();
  const sneaky = { toString: () => (toText(c), "sneaky") };
  if (typeof c.value === "number") {
    const text = `${sneaky}`;
    return text + (c.value + 1);
  }
  return -1;
});
attempt("an addition in between calls valueOf", () => {
  const c = make();
  const sneaky = { valueOf: () => (toText(c), 1) };
  if (typeof c.value === "number") return Number(sneaky) + c.value;
  return -1;
});
