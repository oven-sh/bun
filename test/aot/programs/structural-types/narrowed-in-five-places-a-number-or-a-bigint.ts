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
  value: number | bigint = 1;
}

type Between = (c: Cell) => void;
const keep: Between = () => {};
const spoil: Between = c => {
  c.value = 5n;
};

function half(n: number): number {
  return n / 2;
}

const letters = ["a", "b", "c", "d", "e", "f"];

const uses: [string, (c: Cell, between: Between) => unknown][] = [
  ["read", (c, between) => (typeof c.value === "number" ? (between(c), c.value) : "other")],
  ["plus one", (c, between) => (typeof c.value === "number" ? (between(c), c.value + 1) : "other")],
  ["doubled", (c, between) => (typeof c.value === "number" ? (between(c), c.value * 2) : "other")],
  ["negated", (c, between) => (typeof c.value === "number" ? (between(c), -c.value) : "other")],
  ["compared", (c, between) => (typeof c.value === "number" ? (between(c), c.value > 3) : "other")],
  ["equal to five", (c, between) => (typeof c.value === "number" ? (between(c), c.value === 5) : "other")],
  ["or zero", (c, between) => (typeof c.value === "number" ? (between(c), c.value | 0) : "other")],
  ["halved by a function", (c, between) => (typeof c.value === "number" ? (between(c), half(c.value)) : "other")],
  ["to fixed", (c, between) => (typeof c.value === "number" ? (between(c), c.value.toFixed(1)) : "other")],
  ["floor", (c, between) => (typeof c.value === "number" ? (between(c), Math.floor(c.value)) : "other")],
  ["as an index", (c, between) => (typeof c.value === "number" ? (between(c), letters[c.value]) : "other")],
  ["in a template", (c, between) => (typeof c.value === "number" ? (between(c), `${c.value}`) : "other")],
  [
    "incremented",
    (c, between) => {
      if (typeof c.value === "number") {
        between(c);
        c.value++;
        return c.value;
      }
      return "other";
    },
  ],
  [
    "added to",
    (c, between) => {
      if (typeof c.value === "number") {
        between(c);
        c.value += 1;
        return c.value;
      }
      return "other";
    },
  ],
];

class Owner {
  own: number | bigint = 1;
  change(really: boolean): void {
    if (really) this.own = 5n;
  }
  inItsOwnField(really: boolean): unknown {
    if (typeof this.own === "number") {
      this.change(really);
      return [this.own, -this.own, this.own > 3, this.own === 5];
    }
    return "not a number";
  }
  addsInItsOwnField(really: boolean): unknown {
    if (typeof this.own === "number") {
      this.change(really);
      return this.own + 1;
    }
    return "not a number";
  }
}

function inAnElement(values: (number | bigint)[], really: boolean): unknown {
  const change = (): void => {
    if (really) values[0] = 5n;
  };
  if (typeof values[0] === "number") {
    change();
    return [values[0], -values[0], values[0] > 3];
  }
  return "not a number";
}

function inACapturedVariable(really: boolean): unknown {
  let v: number | bigint = 1;
  const change = (): void => {
    if (really) v = 5n;
  };
  if (typeof v === "number") {
    change();
    return [v, -v, v > 3];
  }
  return "not a number";
}

function round(label: string, between: Between, really: boolean): void {
  for (const [name, use] of uses) attempt(label + " in a parameter, " + name, () => use(new Cell(), between));
  attempt(label + " in its own field", () => new Owner().inItsOwnField(really));
  attempt(label + " in its own field, added to", () => new Owner().addsInItsOwnField(really));
  attempt(label + " in an element", () => inAnElement([1], really));
  attempt(label + " in a captured variable", () => inACapturedVariable(really));
}

round("honest", keep, false);
let rounds = 0;
for (let i = 0; i < 2000; i++) {
  for (const [, use] of uses) use(new Cell(), keep);
  new Owner().inItsOwnField(false);
  new Owner().addsInItsOwnField(false);
  inAnElement([1], false);
  inACapturedVariable(false);
  rounds++;
}
console.log("honest rounds: " + rounds);
round("replaced", spoil, true);
round("honest again", keep, false);
