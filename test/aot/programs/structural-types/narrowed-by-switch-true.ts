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
  shape: Shape = new Square();
  value: number | string | null = 1;
}

type Between = (h: Holder) => void;
const keep: Between = () => {};
const spoil: Between = h => {
  h.shape = new Circle();
  h.value = "text";
};
const clear: Between = h => {
  h.shape = new Shape();
  h.value = null;
};

function byValue(h: Holder, between: Between): unknown {
  switch (true) {
    case typeof h.value === "number":
      between(h);
      return ["number", h.value, h.value + 1, h.value * 2];
    case typeof h.value === "string":
      between(h);
      return ["string", h.value, h.value.length];
    default:
      between(h);
      return ["null", h.value];
  }
}

function byClass(h: Holder, between: Between): unknown {
  switch (true) {
    case h.shape instanceof Square:
      between(h);
      return ["square", h.shape.edge, h.shape.edge * 2];
    case h.shape instanceof Circle:
      between(h);
      return ["circle", h.shape.radius];
    default:
      return ["shape", h.shape.sides];
  }
}

function fallingThrough(h: Holder, between: Between): unknown {
  const seen: unknown[] = [];
  switch (true) {
    case typeof h.value === "number":
      between(h);
      seen.push(h.value);
    case typeof h.value === "string":
      seen.push(h.value === null ? "null" : typeof h.value);
      break;
    default:
      seen.push("default");
  }
  return seen;
}

function theCasesChangeIt(h: Holder): unknown {
  const change = (): boolean => {
    h.value = "text";
    return false;
  };
  switch (true) {
    case h.value === null:
      return "null";
    case change():
      return "never";
    case typeof h.value === "number":
      return ["number", h.value];
    default:
      return ["default", h.value, h.value.length];
  }
}

function round(label: string, between: Between): void {
  attempt(label + ": by value", () => byValue(new Holder(), between));
  attempt(label + ": by class", () => byClass(new Holder(), between));
  attempt(label + ": falling through", () => fallingThrough(new Holder(), between));
}

round("honest", keep);
for (let i = 0; i < 2000; i++) {
  byValue(new Holder(), keep);
  byClass(new Holder(), keep);
  fallingThrough(new Holder(), keep);
}
round("a sibling and a string", spoil);
round("the base class and null", clear);
attempt("a case changes what an earlier case tested", () => theCasesChangeIt(new Holder()));
round("honest again", keep);
