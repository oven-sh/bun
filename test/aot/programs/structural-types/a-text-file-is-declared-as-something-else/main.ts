import answer from "./answer.number" with { type: "text" };
import point from "./place.point" with { type: "text" };

function show(value: unknown): string {
  if (typeof value === "number") return Object.is(value, -0) ? "-0" : String(value);
  if (typeof value === "string") return JSON.stringify(value);
  if (typeof value === "bigint") return value + "n";
  if (value === null || value === undefined) return String(value);
  if (typeof value === "boolean") return String(value);
  if (Array.isArray(value)) {
    const parts: string[] = [];
    for (let i = 0; i < value.length; i++) parts.push(i in value ? show(value[i]) : "hole");
    return "[" + parts.join(", ") + "]";
  }
  return typeof value;
}

const log: string[] = [];

function attempt(label: string, run: () => unknown): void {
  log.length = 0;
  try {
    console.log(label, "->", show(run()), log.join(" "));
  } catch (error) {
    console.log(label, "threw", error instanceof Error ? error.constructor.name : typeof error, log.join(" "));
  }
}

function plusOne(n: number): number {
  return n + 1;
}

function sum(p: { x: number; y: number }): number {
  return p.x + p.y;
}

attempt("honest", () => [plusOne(1), sum({ x: 1, y: 2 })]);
attempt("a number that is a text", () => [answer, typeof answer, plusOne(answer), answer * 2, answer === 42]);
attempt("a number that is a text: a method", () => answer.toFixed(1));
attempt("a point that is a text", () => [typeof point, sum(point), point.x, Object.keys(point).length]);
attempt("in a typed local, a field and an element", () => {
  const n: number = answer;
  class Holder {
    n = answer;
  }
  const list: number[] = [answer, 1];
  return [n + 1, new Holder().n + 1, list];
});
attempt("honest again", () => [plusOne(1), sum({ x: 1, y: 2 })]);
