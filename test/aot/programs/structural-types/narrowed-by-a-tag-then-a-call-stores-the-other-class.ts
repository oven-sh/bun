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

class Circle {
  readonly kind = "circle";
  radius = 1;
}

class Square {
  readonly kind = "square";
  edge = 2;
  corner = 90;
}

type Shape = Circle | Square;

class Holder {
  shape: Shape = new Square();
}

type Between = (h: Holder) => void;
const keep: Between = () => {};
const swap: Between = h => {
  h.shape = new Circle();
};

function edgeOf(s: Square): number {
  return s.edge;
}

const uses: [string, (h: Holder, between: Between) => unknown][] = [
  ["equal", (h, between) => (h.shape.kind === "square" ? (between(h), [h.shape.edge, h.shape.corner, h.shape.kind]) : "other")],
  ["not equal", (h, between) => (h.shape.kind !== "circle" ? (between(h), [h.shape.edge, h.shape.corner, h.shape.kind]) : "other")],
  ["handed on", (h, between) => (h.shape.kind === "square" ? (between(h), edgeOf(h.shape)) : "other")],
  ["stored to", (h, between) => (h.shape.kind === "square" ? (between(h), (h.shape.edge = 7), Object.keys(h.shape).join()) : "other")],
  ["added to", (h, between) => (h.shape.kind === "square" ? (between(h), (h.shape.edge += 7), JSON.stringify(h.shape)) : "other")],
  [
    "in a switch",
    (h, between) => {
      switch (h.shape.kind) {
        case "square":
          between(h);
          return [h.shape.edge, h.shape.corner, h.shape.kind];
        case "circle":
          return "other";
      }
    },
  ],
  [
    "kept in a constant",
    (h, between) => {
      if (h.shape.kind === "square") {
        between(h);
        const s: Square = h.shape;
        return [s.edge, s.corner, s.kind, s instanceof Square];
      }
      return "other";
    },
  ],
];

function round(label: string, between: Between): void {
  for (const [name, use] of uses) attempt(label + " " + name, () => use(new Holder(), between));
}

round("honest", keep);
for (let i = 0; i < 2000; i++) for (const [, use] of uses) use(new Holder(), keep);
round("swapped", swap);
round("honest again", keep);
