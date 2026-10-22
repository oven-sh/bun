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

function spoil(h: Holder): void {
  h.shape = new Shape();
  h.value = "text";
}

const ways: [string, (h: Holder, really: boolean) => unknown][] = [
  ["forEach", (h, really) => [0].forEach(() => really && spoil(h))],
  ["map", (h, really) => [0].map(() => really && spoil(h))],
  ["toSorted", (h, really) => [2, 1].toSorted((a, b) => (really && spoil(h), a - b))],
  ["replace", (h, really) => "a".replace("a", () => (really && spoil(h), "b"))],
  ["Array.from", (h, really) => Array.from({ length: 1 }, () => really && spoil(h))],
  ["JSON.stringify and toJSON", (h, really) => JSON.stringify({ toJSON: () => (really && spoil(h), 1) })],
  ["JSON.parse and a reviver", (h, really) => JSON.parse("1", (key, value) => (really && spoil(h), value))],
  ["a Promise executor", (h, really) => new Promise<void>(resolve => (really && spoil(h), resolve()))],
  ["a template and toString", (h, really) => `${{ toString: () => (really && spoil(h), "s") }}`],
  ["Number and valueOf", (h, really) => Number({ valueOf: () => (really && spoil(h), 1) })],
  ["an addition and toPrimitive", (h, really) => ({ [Symbol.toPrimitive]: () => (really && spoil(h), "p") }) + ""],
  ["a spread and an iterator", (h, really) => [...{ *[Symbol.iterator]() { if (really) spoil(h); yield 1; } }]],
  ["Object.assign and a getter", (h, really) => Object.assign({}, { get a() { return really && spoil(h); } })],
  ["a Map and forEach", (h, really) => new Map([[1, 1]]).forEach(() => really && spoil(h))],
  ["Reflect.apply", (h, really) => Reflect.apply(() => really && spoil(h), undefined, [])],
  ["a bound function", (h, really) => (really ? spoil.bind(null, h)() : undefined)],
  ["a tagged template", (h, really) => ((strings: TemplateStringsArray) => really && spoil(h))``],
  ["a key with toString", (h, really) => ({ a: 1 })[String({ toString: () => (really && spoil(h), "a") }) === "a" ? "a" : "a"]],
];

function read(h: Holder, way: (h: Holder, really: boolean) => unknown, really: boolean): unknown {
  if (h.shape instanceof Square && typeof h.value === "number") {
    way(h, really);
    return [h.shape.edge, h.shape.edge * 2, h.value, h.value + 1, h.value * 2];
  }
  return "other";
}

for (const [name, way] of ways) attempt("honest: " + name, () => read(new Holder(), way, false));
for (let i = 0; i < 300; i++) for (const [, way] of ways) read(new Holder(), way, false);
for (const [name, way] of ways) attempt("the callback stores: " + name, () => read(new Holder(), way, true));
for (const [name, way] of ways) attempt("honest again: " + name, () => read(new Holder(), way, false));
