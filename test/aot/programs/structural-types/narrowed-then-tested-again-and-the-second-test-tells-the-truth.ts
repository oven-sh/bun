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

class Circle extends Shape {
  radius = 5;
}

class Holder {
  value: number | string = 1;
  count: number | bigint = 1;
  shape: Shape = new Square();
  leaf: Square | null = new Square();
  spare: Square | undefined = new Square();
  mode: "on" | "off" = "on";
  work: (() => number) | Square = () => 1;
  list: number[] | string = [1, 2];
  point: [number] | [number, number] = [1, 2];
  either: Square | Circle = new Square();
}

type Between = (h: Holder) => void;
const keep: Between = () => {};
const spoil: Between = h => {
  h.value = "text";
  h.count = 5n;
  h.shape = new Circle();
  h.leaf = null;
  h.spare = undefined;
  h.mode = "off";
  h.work = new Square();
  h.list = "text";
  h.point = [9];
  h.either = new Circle();
};

const uses: [string, (h: Holder, between: Between) => unknown][] = [
  ["typeof number", (h, between) => (typeof h.value === "number" ? (between(h), [typeof h.value === "number", typeof h.value !== "number", typeof h.value === "string", typeof h.value]) : "other")],
  ["typeof number beside a bigint", (h, between) => (typeof h.count === "number" ? (between(h), [typeof h.count === "number", typeof h.count === "bigint", typeof h.count]) : "other")],
  ["instanceof", (h, between) => (h.shape instanceof Square ? (between(h), [h.shape instanceof Square, h.shape instanceof Circle, h.shape instanceof Shape, "edge" in h.shape]) : "other")],
  ["not null", (h, between) => (h.leaf !== null ? (between(h), [h.leaf === null, h.leaf !== null, h.leaf == null, !h.leaf, h.leaf ? "truthy" : "falsy", h.leaf?.edge, h.leaf ?? "nothing", typeof h.leaf]) : "other")],
  ["not undefined", (h, between) => (h.spare !== undefined ? (between(h), [h.spare === undefined, typeof h.spare === "undefined", typeof h.spare, h.spare?.edge, h.spare ?? "nothing"]) : "other")],
  ["a literal", (h, between) => (h.mode === "on" ? (between(h), [h.mode === "on", h.mode !== "on", h.mode == "on", ["on"].includes(h.mode)]) : "other")],
  ["typeof function", (h, between) => (typeof h.work === "function" ? (between(h), [typeof h.work === "function", typeof h.work === "object", typeof h.work, h.work instanceof Function]) : "other")],
  ["is array", (h, between) => (Array.isArray(h.list) ? (between(h), [Array.isArray(h.list), typeof h.list === "object", typeof h.list, h.list instanceof Array]) : "other")],
  ["the length of a tuple", (h, between) => (h.point.length === 2 ? (between(h), [h.point.length === 2, h.point.length > 1, h.point.length, 1 in h.point]) : "other")],
  ["in", (h, between) => ("edge" in h.either ? (between(h), ["edge" in h.either, "radius" in h.either, h.either instanceof Square]) : "other")],
  ["a second if", (h, between) => {
    if (typeof h.value === "number") {
      between(h);
      if (typeof h.value === "number") return "still a number";
      return "no longer a number";
    }
    return "other";
  }],
  ["a switch over typeof", (h, between) => {
    if (typeof h.value === "number") {
      between(h);
      switch (typeof h.value) {
        case "number":
          return "still a number";
        default:
          return "no longer a number";
      }
    }
    return "other";
  }],
  ["a loop that waits for the change", (h, between) => {
    let turns = 0;
    if (h.leaf !== null) {
      while (h.leaf !== null && turns < 3) {
        turns++;
        if (turns === 2) between(h);
      }
    }
    return turns;
  }],
];

function round(label: string, between: Between): void {
  for (const [name, use] of uses) attempt(label + ": " + name, () => use(new Holder(), between));
}

round("honest", keep);
for (let i = 0; i < 2000; i++) for (const [, use] of uses) use(new Holder(), keep);
round("changed", spoil);
round("honest again", keep);
