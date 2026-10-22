function text(value: unknown): string {
  if (typeof value === "number") return "number " + (Object.is(value, -0) ? "-0" : String(value));
  if (typeof value === "string") return "string " + JSON.stringify(value);
  if (typeof value === "function") return "function " + value.name;
  if (Array.isArray(value)) {
    const parts: string[] = [];
    for (let i = 0; i < value.length; i++) parts.push(i in value ? text(value[i]) : "hole");
    return "[" + parts.join(", ") + "]";
  }
  if (typeof value === "object" && value !== null) return "object " + JSON.stringify(value);
  return typeof value + " " + String(value);
}

function show(label: string, run: () => unknown): void {
  try {
    console.log(label + ": " + text(run()));
  } catch (error) {
    console.log(label + ": threw " + (error instanceof Error ? error.constructor.name : typeof error));
  }
}

declare global {
  interface Number {
    doubled(): number;
    unit: string;
    half: number;
  }
}

function doubledOf(n: number): number {
  return n.doubled();
}

function halfOf(n: number): number {
  return n.half;
}

function unitOf(n: number): string {
  return n.unit;
}

const whole = 4;
const fraction = 4.5;
show("typeof the method", () => [typeof whole.doubled, typeof fraction.doubled]);
show("called on a whole number", () => whole.doubled());
show("called on a fraction", () => fraction.doubled());
show("called on a literal", () => (7).doubled());
show("called on a sum", () => (whole + fraction).doubled());
show("called on NaN", () => NaN.doubled());
show("called if there", () => whole.doubled?.());
show("through a function", () => doubledOf(whole));
show("the number", () => [whole.half, fraction.half, typeof whole.half]);
show("the number plus one", () => whole.half + 1);
show("the number through a function", () => [halfOf(whole), halfOf(fraction), halfOf(-0)]);
show("the number added to itself", () => halfOf(whole) + whole);
show("the text", () => [whole.unit, unitOf(fraction)]);
show("the length of the text", () => unitOf(whole).length);
show("on a Number object", () => [new Number(1).half, typeof new Number(1).doubled]);
show("on the prototype", () => "doubled" in Number.prototype);
show("on an element", () => [1, 2].map(n => n.half));
show("on a field", () => {
  class Holder {
    n: number = 3;
  }
  return new Holder().n.half;
});
show("what every number really has still works", () => [whole.toFixed(1), fraction.toString(), whole.valueOf() + 1]);

let failures = 0;
let missing = 0;
for (let i = 0; i < 2000; i++) {
  if (halfOf(i) === undefined) missing++;
  try {
    doubledOf(i + 0.5);
  } catch {
    failures++;
  }
}
show("2000 rounds", () => [missing, failures]);

export {};
