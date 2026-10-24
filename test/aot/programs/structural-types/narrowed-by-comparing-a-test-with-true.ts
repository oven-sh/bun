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

class Holder {
  shape: Shape = new Square();
  value: number | string = 1;
}

function isSquare(s: Shape): s is Square {
  return s instanceof Square;
}

function isNumber(v: number | string): v is number {
  return typeof v === "number";
}

type Between = (h: Holder) => void;
const keep: Between = () => {};
const spoil: Between = h => {
  h.shape = new Shape();
  h.value = "text";
};

const uses: [string, (h: Holder, between: Between) => unknown][] = [
  ["equal to true", (h, between) => (isSquare(h.shape) === true ? (between(h), [h.shape.edge, h.shape.edge * 2]) : "other")],
  ["not equal to false", (h, between) => (isSquare(h.shape) !== false ? (between(h), [h.shape.edge, h.shape.edge * 2]) : "other")],
  ["equal to false, the other branch", (h, between) => (isSquare(h.shape) === false ? "other" : (between(h), [h.shape.edge, h.shape.edge * 2]))],
  ["true on the left", (h, between) => (true === isNumber(h.value) ? (between(h), [h.value, h.value + 1, h.value * 2]) : "other")],
  ["loosely equal to true", (h, between) => (isNumber(h.value) == true ? (between(h), [h.value, h.value + 1, h.value * 2]) : "other")],
  ["negated twice", (h, between) => (!!isNumber(h.value) ? (between(h), [h.value, h.value + 1, h.value * 2]) : "other")],
  ["a test compared with true", (h, between) => ((typeof h.value === "number") === true ? (between(h), [h.value, h.value + 1, h.value * 2]) : "other")],
  ["an instanceof compared with true", (h, between) => ((h.shape instanceof Square) === true ? (between(h), [h.shape.edge, h.shape.edge * 2]) : "other")],
];

function round(label: string, between: Between): void {
  for (const [name, use] of uses) attempt(label + ": " + name, () => use(new Holder(), between));
}

round("honest", keep);
for (let i = 0; i < 2000; i++) for (const [, use] of uses) use(new Holder(), keep);
round("replaced", spoil);
round("honest again", keep);
