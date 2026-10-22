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
  kind: "circle" = "circle";
  radius = 1;
}

class Square {
  kind: "square" = "square";
  edge = 2;
}

type Shape = Circle | Square;

function retag(o: { kind: string }, kind: string): void {
  o.kind = kind;
}

function triangle(): Shape {
  const s = new Square();
  retag(s, "triangle");
  return s;
}

function offTheEnd(s: Shape): number {
  switch (s.kind) {
    case "circle":
      return s.radius;
    case "square":
      return s.edge;
  }
}

function intoTheDefault(s: Shape): unknown {
  switch (s.kind) {
    case "circle":
      return s.radius;
    case "square":
      return s.edge;
    default: {
      const impossible: never = s;
      return ["typed never", typeof impossible, JSON.stringify(impossible)];
    }
  }
}

function pastTheLastElse(s: Shape): unknown {
  if (s.kind === "circle") return s.radius;
  else if (s.kind === "square") return s.edge;
  else return ["typed never", typeof s];
}

function refuses(value: never): never {
  throw new RangeError("unexpected");
}

function intoARefusal(s: Shape): unknown {
  if (s.kind === "circle") return s.radius;
  if (s.kind === "square") return s.edge;
  return refuses(s);
}

function afterTheChain(s: Shape): unknown {
  let result = "nothing was stored";
  if (s.kind === "circle") result = "circle";
  else if (s.kind === "square") result = "square";
  return result;
}

function aTableOfHandlers(s: Shape): unknown {
  const handlers = { circle: () => "round", square: () => "flat" };
  return handlers[s.kind]();
}

const uses: [string, (s: Shape) => unknown][] = [
  ["a switch without a default", offTheEnd],
  ["a switch with a default", intoTheDefault],
  ["a chain of ifs", pastTheLastElse],
  ["a function that takes never", intoARefusal],
  ["a variable that every branch stores to", afterTheChain],
  ["a table of handlers", aTableOfHandlers],
];

for (const [name, use] of uses) attempt("honest: " + name, () => [use(new Circle()), use(new Square())]);
for (let i = 0; i < 2000; i++) for (const [, use] of uses) use(i % 2 === 0 ? new Circle() : new Square());
for (const [name, use] of uses) attempt("a tag outside the union: " + name, () => use(triangle()));
attempt("the result typed number is used", () => {
  const n: number = offTheEnd(triangle());
  return [n, n + 1, n * 2];
});
for (const [name, use] of uses) attempt("honest again: " + name, () => [use(new Circle()), use(new Square())]);
