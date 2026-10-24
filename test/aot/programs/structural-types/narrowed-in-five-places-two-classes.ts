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
  corner = 90;
  area(): number {
    return this.edge * this.edge;
  }
}

class Circle extends Shape {
  radius = 5;
}

class Holder {
  shape: Shape = new Square();
}

type Between = (h: Holder) => void;
const keep: Between = () => {};
const toBase: Between = h => {
  h.shape = new Shape();
};
const toSibling: Between = h => {
  h.shape = new Circle();
};

function edgeOf(s: Square): number {
  return s.edge;
}

function inAParameter(h: Holder, between: Between): unknown {
  if (h.shape instanceof Square) {
    between(h);
    return [h.shape.edge, h.shape.corner, h.shape.sides, edgeOf(h.shape), Object.keys(h.shape).join()];
  }
  return "not a square";
}

function callsInAParameter(h: Holder, between: Between): unknown {
  if (h.shape instanceof Square) {
    between(h);
    return h.shape.area();
  }
  return "not a square";
}

function inALocal(between: Between): unknown {
  const h = new Holder();
  if (h.shape instanceof Square) {
    between(h);
    return [h.shape.edge, h.shape.corner, h.shape.sides, edgeOf(h.shape)];
  }
  return "not a square";
}

class Owner {
  holder = new Holder();
  own: Shape = new Square();
  inAField(between: Between): unknown {
    if (this.holder.shape instanceof Square) {
      between(this.holder);
      return [this.holder.shape.edge, this.holder.shape.corner, this.holder.shape.sides, edgeOf(this.holder.shape)];
    }
    return "not a square";
  }
  change(to: Shape | null): void {
    if (to !== null) this.own = to;
  }
  inItsOwnField(to: Shape | null): unknown {
    if (this.own instanceof Square) {
      this.change(to);
      return [this.own.edge, this.own.corner, this.own.sides, edgeOf(this.own)];
    }
    return "not a square";
  }
}

function inAnElement(shapes: Shape[], to: Shape | null): unknown {
  const change = (): void => {
    if (to !== null) shapes[0] = to;
  };
  if (shapes[0] instanceof Square) {
    change();
    return [shapes[0].edge, shapes[0].corner, shapes[0].sides, edgeOf(shapes[0])];
  }
  return "not a square";
}

function inACapturedVariable(to: Shape | null): unknown {
  let s: Shape = new Square();
  const change = (): void => {
    if (to !== null) s = to;
  };
  if (s instanceof Square) {
    change();
    return [s.edge, s.corner, s.sides, edgeOf(s)];
  }
  return "not a square";
}

function round(label: string, between: Between, make: () => Shape | null): void {
  attempt(label + " in a parameter", () => inAParameter(new Holder(), between));
  attempt(label + " in a parameter, a method", () => callsInAParameter(new Holder(), between));
  attempt(label + " in a local", () => inALocal(between));
  attempt(label + " in a field", () => new Owner().inAField(between));
  attempt(label + " in its own field", () => new Owner().inItsOwnField(make()));
  attempt(label + " in an element", () => inAnElement([new Square()], make()));
  attempt(label + " in a captured variable", () => inACapturedVariable(make()));
}

round("honest", keep, () => null);
let rounds = 0;
for (let i = 0; i < 2000; i++) {
  inAParameter(new Holder(), keep);
  callsInAParameter(new Holder(), keep);
  inALocal(keep);
  new Owner().inAField(keep);
  new Owner().inItsOwnField(null);
  inAnElement([new Square()], null);
  inACapturedVariable(null);
  rounds++;
}
console.log("honest rounds: " + rounds);
round("the base class", toBase, () => new Shape());
round("a sibling", toSibling, () => new Circle());
round("honest again", keep, () => null);
