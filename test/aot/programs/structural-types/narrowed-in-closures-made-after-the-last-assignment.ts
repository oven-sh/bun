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

function afterTheLastAssignment(input: number | string | null): () => unknown {
  let v = input;
  if (v === null) v = 0;
  if (typeof v === "string") v = v.length;
  return () => [v, v + 1, v * 2];
}

function aParameter(v: number | string): () => unknown {
  if (typeof v === "string") v = v.length;
  return () => [v, v + 1, v * 2];
}

function aClass(s: Square | null): () => unknown {
  if (s === null) s = new Square();
  return () => [s.edge, s.edge * 2, s.sides];
}

function manyClosures(v: number | string | undefined): (() => unknown)[] {
  if (v === undefined) v = 1;
  if (typeof v === "string") return [() => v.length, () => v.toUpperCase()];
  return [() => v + 1, () => v.toFixed(1), () => [1, 2, 3].map(n => n * v)];
}

function inAMethodOfALiteral(v: number | null): { read(): number; get twice(): number } {
  if (v === null) v = 5;
  return {
    read() {
      return v + 1;
    },
    get twice() {
      return v * 2;
    },
  };
}

attempt("null", afterTheLastAssignment(null));
attempt("a string", afterTheLastAssignment("four"));
attempt("a number", afterTheLastAssignment(2.5));
attempt("a parameter, a string", aParameter("four"));
attempt("a parameter, a number", aParameter(-0));
attempt("a class, null", aClass(null));
attempt("a class, a square", aClass(new Square()));
attempt("many closures, undefined", () => manyClosures(undefined).map(f => f()));
attempt("many closures, a string", () => manyClosures("ab").map(f => f()));
attempt("many closures, a number", () => manyClosures(3).map(f => f()));
attempt("a method and a getter of a literal", () => {
  const o = inAMethodOfALiteral(null);
  return [o.read(), o.twice, inAMethodOfALiteral(1).read()];
});
let sum = 0;
for (let i = 0; i < 2000; i++) {
  const made = aParameter(i % 2 === 0 ? i : "ab");
  const result = made();
  if (Array.isArray(result)) sum += result.length;
}
console.log("honest rounds: " + sum);
attempt("called later, from a built-in", () => [3, "abc", null].map(v => afterTheLastAssignment(v)).map(f => f()));
