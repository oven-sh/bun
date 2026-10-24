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

type Point = [number] | [number, number];
type Message = ["count", number] | ["name", string];

class Holder {
  point: Point = [1, 2];
  message: Message = ["count", 1];
  list: number[] | string = [1, 2, 3];
}

type Between = (h: Holder) => void;
const keep: Between = () => {};
const inPlace: Between = h => {
  const numbers: number[] = h.point;
  numbers.pop();
  const parts: (string | number)[] = h.message;
  parts[1] = "text";
  if (typeof h.list !== "string") h.list.length = 0;
};
const replaced: Between = h => {
  h.point = [9];
  h.message = ["name", "text"];
  h.list = "text";
};

function second(p: [number, number]): number {
  return p[1];
}

const uses: [string, (h: Holder, between: Between) => unknown][] = [
  ["by length, the second", (h, between) => (h.point.length === 2 ? (between(h), h.point[1]) : "other")],
  ["by length, the second plus one", (h, between) => (h.point.length === 2 ? (between(h), h.point[1] + 1) : "other")],
  ["by length, the length", (h, between) => (h.point.length === 2 ? (between(h), h.point.length) : "other")],
  ["by length, handed on", (h, between) => (h.point.length === 2 ? (between(h), second(h.point)) : "other")],
  [
    "by length, destructured",
    (h, between) => {
      if (h.point.length === 2) {
        between(h);
        const [a, b] = h.point;
        return [a, b, a + b];
      }
      return "other";
    },
  ],
  ["by length, spread", (h, between) => (h.point.length === 2 ? (between(h), Math.max(...h.point)) : "other")],
  ["by a tag, the rest", (h, between) => (h.message[0] === "count" ? (between(h), h.message[1]) : "other")],
  ["by a tag, the rest plus one", (h, between) => (h.message[0] === "count" ? (between(h), h.message[1] + 1) : "other")],
  ["by a tag, the tag", (h, between) => (h.message[0] === "count" ? (between(h), h.message[0]) : "other")],
  ["by is array, the first", (h, between) => (Array.isArray(h.list) ? (between(h), h.list[0]) : "other")],
  ["by is array, the length", (h, between) => (Array.isArray(h.list) ? (between(h), h.list.length) : "other")],
  ["by is array, joined", (h, between) => (Array.isArray(h.list) ? (between(h), h.list.join("-")) : "other")],
  ["by is array, pushed to", (h, between) => (Array.isArray(h.list) ? (between(h), h.list.push(4)) : "other")],
  ["by typeof, the first", (h, between) => (typeof h.list !== "string" ? (between(h), h.list[0]) : "other")],
  [
    "by is array, summed",
    (h, between) => {
      if (Array.isArray(h.list)) {
        between(h);
        let sum = 0;
        for (const n of h.list) sum += n;
        return sum;
      }
      return "other";
    },
  ],
];

function inACapturedVariable(really: boolean): unknown {
  let p: Point = [1, 2];
  const change = (): void => {
    if (really) p = [9];
  };
  if (p.length === 2) {
    change();
    return [p[1], p.length];
  }
  return "other";
}

function inAnElement(points: Point[], really: boolean): unknown {
  const change = (): void => {
    if (really) points[0] = [9];
  };
  if (points[0].length === 2) {
    change();
    return [points[0][1], points[0].length];
  }
  return "other";
}

function round(label: string, between: Between, really: boolean): void {
  for (const [name, use] of uses) attempt(label + " " + name, () => use(new Holder(), between));
  attempt(label + " in a captured variable", () => inACapturedVariable(really));
  attempt(label + " in an element", () => inAnElement([[1, 2]], really));
}

round("honest", keep, false);
let rounds = 0;
for (let i = 0; i < 2000; i++) {
  for (const [, use] of uses) use(new Holder(), keep);
  inACapturedVariable(false);
  inAnElement([[1, 2]], false);
  rounds++;
}
console.log("honest rounds: " + rounds);
round("changed in place", inPlace, true);
round("replaced", replaced, true);
round("honest again", keep, false);
