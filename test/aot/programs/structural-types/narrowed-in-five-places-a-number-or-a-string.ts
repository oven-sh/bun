function text(value: unknown): string {
  if (typeof value === "number") return "number " + (Object.is(value, -0) ? "-0" : String(value));
  if (typeof value === "bigint") return "bigint " + String(value);
  if (typeof value === "string") return "string " + JSON.stringify(value);
  if (typeof value === "function") return "function";
  if (Array.isArray(value)) return "[" + value.map(text).join(", ") + "]";
  if (typeof value === "object" && value !== null) return value.constructor.name + " " + JSON.stringify(value);
  return String(value);
}

function attempt(label: string, run: () => unknown): void {
  try {
    console.log(label + ": " + text(run()));
  } catch (error) {
    console.log(label + ": threw " + (error instanceof Error ? error.constructor.name : typeof error));
  }
}

class Cell {
  value: number | string = 1;
}

type Between = (c: Cell) => void;
const keep: Between = () => {};
const spoil: Between = c => {
  c.value = "text";
};

function half(n: number): number {
  return n / 2;
}

function inAParameter(c: Cell, between: Between): unknown {
  if (typeof c.value === "number") {
    between(c);
    return [c.value, c.value + 1, c.value * 2, half(c.value)];
  }
  return "not a number";
}

function inALocal(between: Between): unknown {
  const c = new Cell();
  if (typeof c.value === "number") {
    between(c);
    return [c.value, c.value + 1, c.value * 2, half(c.value)];
  }
  return "not a number";
}

class Owner {
  cell = new Cell();
  own: number | string = 1;
  inAField(between: Between): unknown {
    if (typeof this.cell.value === "number") {
      between(this.cell);
      return [this.cell.value, this.cell.value + 1, this.cell.value * 2, half(this.cell.value)];
    }
    return "not a number";
  }
  change(really: boolean): void {
    if (really) this.own = "text";
  }
  inItsOwnField(really: boolean): unknown {
    if (typeof this.own === "number") {
      this.change(really);
      return [this.own, this.own + 1, this.own * 2, half(this.own)];
    }
    return "not a number";
  }
}

function inAnElement(cells: Cell[], values: (number | string)[], really: boolean): unknown {
  const change = (): void => {
    if (really) {
      cells[0].value = "text";
      values[0] = "text";
    }
  };
  if (typeof cells[0].value === "number" && typeof values[0] === "number") {
    change();
    return [cells[0].value, cells[0].value + 1, half(cells[0].value), values[0], values[0] + 1, half(values[0])];
  }
  return "not a number";
}

function inACapturedVariable(really: boolean): unknown {
  let v: number | string = 1;
  const change = (): void => {
    if (really) v = "text";
  };
  if (typeof v === "number") {
    change();
    return [v, v + 1, v * 2, half(v)];
  }
  return "not a number";
}

function round(label: string, between: Between, really: boolean): void {
  attempt(label + " in a parameter", () => inAParameter(new Cell(), between));
  attempt(label + " in a local", () => inALocal(between));
  attempt(label + " in a field", () => new Owner().inAField(between));
  attempt(label + " in its own field", () => new Owner().inItsOwnField(really));
  attempt(label + " in an element", () => inAnElement([new Cell()], [1], really));
  attempt(label + " in a captured variable", () => inACapturedVariable(really));
}

round("honest", keep, false);
let rounds = 0;
for (let i = 0; i < 2000; i++) {
  inAParameter(new Cell(), keep);
  inALocal(keep);
  new Owner().inAField(keep);
  new Owner().inItsOwnField(false);
  inAnElement([new Cell()], [1], false);
  inACapturedVariable(false);
  rounds++;
}
console.log("honest rounds: " + rounds);
round("replaced", spoil, true);
round("honest again", keep, false);
