import { count, fillKennel, makeColor, makeDog, makeDogs, makePoint, makeShape, spoil, spoilerCount } from "./library.js";
import { Color, Dog, Kennel, type Point, type Shape } from "./shapes.ts";

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

function sum(p: Point): number {
  return p.x + p.y;
}

function legs(d: Dog): number {
  return d.legs + 1;
}

function bark(d: Dog): number {
  return d.bark();
}

function title(d: Dog): string {
  return d.name.toUpperCase();
}

function area(s: Shape): number {
  switch (s.kind) {
    case "circle":
      return s.radius * 3;
    case "square":
      return s.side * s.side;
  }
}

function colorName(c: Color): string {
  return c === Color.Red ? "red" : c === Color.Green ? "green" : "other";
}

attempt("honest", () => [sum({ x: 1, y: 2 }), legs(new Dog()), bark(new Dog()), title(new Dog()), area({ kind: "circle", radius: 1 }), colorName(Color.Green)]);
let warm = 0;
for (let i = 0; i < 2000; i++) warm += sum({ x: i, y: 1 }) + legs(new Dog()) + bark(new Dog()) + title(new Dog()).length + area({ kind: "square", side: i });
console.log("2000 honest rounds", warm);

for (let i = 0; i < count("point"); i++) {
  attempt("point " + i + ": sum", () => sum(makePoint(i)));
  attempt("point " + i + ": kept", () => {
    const p: Point = makePoint(i);
    const list: Point[] = [p];
    return [p.x, list[0].y];
  });
}
for (let i = 0; i < count("dog"); i++) {
  attempt("dog " + i + ": legs", () => legs(makeDog(i)));
  attempt("dog " + i + ": bark", () => bark(makeDog(i)));
  attempt("dog " + i + ": title", () => title(makeDog(i)));
  attempt("dog " + i + ": instanceof and keys", () => [makeDog(i) instanceof Dog, Object.keys(makeDog(i))]);
  attempt("dog " + i + ": in a kennel", () => {
    const k = new Kennel();
    k.dogs.push(new Dog(), makeDog(i));
    return k.dogs.map(d => d.legs);
  });
}
for (let i = 0; i < count("shape"); i++) attempt("shape " + i, () => area(makeShape(i)));
for (let i = 0; i < count("color"); i++) attempt("color " + i, () => [colorName(makeColor(i)), makeColor(i) + 1, Color[makeColor(i)]]);
attempt("a list of dogs", () => makeDogs().map(d => d.legs));
attempt("a list of dogs: a method", () => makeDogs().map(bark));

for (let i = 0; i < spoilerCount; i++) {
  attempt("a real dog spoiled " + i + ": legs", () => {
    const d = new Dog();
    spoil(d, i);
    return [legs(d), d.legs];
  });
  attempt("a real dog spoiled " + i + ": bark", () => {
    const d = new Dog();
    spoil(d, i);
    return bark(d);
  });
  attempt("a real dog spoiled " + i + ": stored to", () => {
    const d = new Dog();
    spoil(d, i);
    d.legs = 8;
    return [d.legs, Object.keys(d), d instanceof Dog];
  });
  attempt("a real dog spoiled " + i + ": title", () => {
    const d = new Dog();
    spoil(d, i);
    return title(d);
  });
}
attempt("a kennel filled by the module", () => {
  const k = new Kennel();
  k.dogs.push(new Dog());
  fillKennel(k);
  return [k.dogs.length, k.first().legs, k.dogs[1].legs, k.dogs[2], k.at];
});
attempt("a kennel filled by the module: used", () => {
  const k = new Kennel();
  fillKennel(k);
  return [legs(k.first()), sum(k.at)];
});
attempt("a kennel filled by the module: a method", () => {
  const k = new Kennel();
  fillKennel(k);
  return bark(k.first());
});
attempt("honest again", () => [sum({ x: 1, y: 2 }), legs(new Dog()), bark(new Dog()), title(new Dog()), area({ kind: "circle", radius: 1 })]);
