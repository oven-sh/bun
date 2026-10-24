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

class Shape {
  sides = 4;
}

class Square extends Shape {
  edge = 2;
}

class Cell {
  readonly value: number | string = 1;
  readonly shape: Shape = new Square();
  readonly next: Cell | null = null;
}

type Loose = { value: number | string; shape: Shape; next: Cell | null };
type Between = (c: Loose) => void;
const keep: Between = () => {};
const spoil: Between = c => {
  c.value = "text";
  c.shape = new Shape();
  c.next = null;
};

function withNext(): Cell {
  const c = new Cell();
  const loose: Loose = c;
  loose.next = new Cell();
  return c;
}

const uses: [string, (c: Cell, between: Between) => unknown][] = [
  ["typeof", (c, between) => {
    const isNumber = typeof c.value === "number";
    between(c);
    if (isNumber) return [c.value, c.value + 1, c.value * 2];
    return "other";
  }],
  ["instanceof", (c, between) => {
    const isSquare = c.shape instanceof Square;
    between(c);
    if (isSquare) return [c.shape.edge, c.shape.edge * 2, c.shape.sides];
    return "other";
  }],
  ["not null", (c, between) => {
    const hasNext = c.next !== null;
    between(c);
    if (hasNext) return c.next.value;
    return "other";
  }],
  ["two conditions in one constant", (c, between) => {
    const both = typeof c.value === "number" && c.shape instanceof Square;
    between(c);
    if (both) return [c.value + 1, c.shape.edge];
    return "other";
  }],
  ["a constant made from a constant", (c, between) => {
    const isNumber = typeof c.value === "number";
    const really = isNumber;
    between(c);
    return really ? c.value + 1 : "other";
  }],
  ["the negation", (c, between) => {
    const isText = typeof c.value === "string";
    between(c);
    if (!isText) return c.value + 1;
    return "other";
  }],
  ["used twice, the change in between", (c, between) => {
    const isNumber = typeof c.value === "number";
    const first = isNumber ? c.value + 1 : "other";
    between(c);
    const second = isNumber ? c.value + 1 : "other";
    return [first, second];
  }],
];

function round(label: string, between: Between): void {
  for (const [name, use] of uses) attempt(label + ": " + name, () => use(withNext(), between));
}

round("honest", keep);
for (let i = 0; i < 2000; i++) for (const [, use] of uses) use(withNext(), keep);
round("changed through a view that may store", spoil);
round("honest again", keep);
