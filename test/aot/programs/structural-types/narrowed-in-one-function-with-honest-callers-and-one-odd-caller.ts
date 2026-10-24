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
  constructor(readonly hook: (h: Holder) => void) {}
}

function edgeOf(h: Holder): unknown {
  if (h.shape instanceof Square) {
    h.hook(h);
    return [h.shape.edge, h.shape.edge * 2, h.shape.sides];
  }
  return "other";
}

const quiet = (h: Holder): void => {};
const swaps = (h: Holder): void => {
  h.shape = new Circle();
};

function firstHonestCaller(): unknown {
  return edgeOf(new Holder(quiet));
}

function secondHonestCaller(): unknown {
  const h = new Holder(quiet);
  return [edgeOf(h), edgeOf(h)];
}

function thirdHonestCaller(): unknown {
  let last: unknown = null;
  for (let i = 0; i < 2000; i++) last = edgeOf(new Holder(quiet));
  return last;
}

function oddCaller(): unknown {
  return edgeOf(new Holder(swaps));
}

const table = { edgeOf };
const list = [edgeOf];

attempt("the first honest caller", firstHonestCaller);
attempt("the second honest caller", secondHonestCaller);
attempt("the third honest caller", thirdHonestCaller);
attempt("the odd caller", oddCaller);
attempt("the odd caller through call", () => edgeOf.call(undefined, new Holder(swaps)));
attempt("the odd caller through apply", () => edgeOf.apply(undefined, [new Holder(swaps)]));
attempt("the odd caller through bind", () => edgeOf.bind(undefined, new Holder(swaps))());
attempt("the odd caller through a member", () => table.edgeOf(new Holder(swaps)));
attempt("the odd caller through an element", () => list[0](new Holder(swaps)));
attempt("the odd caller through map", () => [new Holder(quiet), new Holder(swaps), new Holder(quiet)].map(edgeOf));
attempt("the odd caller through Reflect.apply", () => Reflect.apply(edgeOf, undefined, [new Holder(swaps)]));
attempt("the first honest caller again", firstHonestCaller);
attempt("the second honest caller again", secondHonestCaller);
