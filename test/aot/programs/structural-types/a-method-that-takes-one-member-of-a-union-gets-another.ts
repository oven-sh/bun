function text(value: unknown): string {
  if (typeof value === "number") return "number " + (Object.is(value, -0) ? "-0" : String(value));
  if (typeof value === "function") return "function " + value.name;
  if (typeof value === "object" && value !== null) return value.constructor.name + " " + JSON.stringify(value);
  return typeof value + " " + String(value);
}

function show(label: string, run: () => unknown): void {
  try {
    console.log(label + ": " + text(run()));
  } catch (error) {
    console.log(label + ": threw " + (error instanceof Error ? error.constructor.name : typeof error));
  }
}

interface Circle {
  kind: "circle";
  radius: number;
}
interface Square {
  kind: "square";
  side: number;
}
interface Label {
  kind: "label";
  text: string;
  radius: string;
}
type Shape = Circle | Square | Label;

interface Wide {
  kind(s: Shape): string;
  isCircle(s: Shape): boolean;
  isNotCircle(s: Shape): boolean;
  radius(s: Shape): number;
  area(s: Shape): number;
  guarded(s: Shape): number;
  switched(s: Shape): string;
  grow(s: Shape): void;
  onlyUndefined(v: undefined | number | null | string): string;
  onlyNull(v: undefined | number | null | string): string;
  onlyTrue(v: boolean | number): string;
  onlyOne(v: number): string;
}

class Narrow implements Wide {
  kind(c: Circle): string {
    return c.kind;
  }
  isCircle(c: Circle): boolean {
    return c.kind === "circle";
  }
  isNotCircle(c: Circle): boolean {
    return c.kind !== "circle";
  }
  radius(c: Circle): number {
    return c.radius;
  }
  area(c: Circle): number {
    return c.radius * c.radius * 3;
  }
  guarded(c: Circle): number {
    return c.kind === "circle" ? c.radius : -1;
  }
  switched(c: Circle): string {
    switch (c.kind) {
      case "circle":
        return "a circle";
      default:
        return "something else";
    }
  }
  grow(c: Circle): void {
    c.radius += 1;
  }
  onlyUndefined(u: undefined): string {
    return (u === undefined) + " " + typeof u + " " + (u ?? "fallback") + " " + String(u);
  }
  onlyNull(n: null): string {
    return (n === null) + " " + typeof n + " " + (n ?? "fallback") + " " + String(n);
  }
  onlyTrue(t: true): string {
    return (t === true) + " " + (t ? "yes" : "no") + " " + !t + " " + String(t);
  }
  onlyOne(one: 1): string {
    return (one === 1) + " " + (one + 1) + " " + one * 2 + " " + String(one);
  }
}

const wide: Wide = new Narrow();
const shapes: [string, () => Shape][] = [
  ["circle", () => ({ kind: "circle", radius: 2 })],
  ["square", () => ({ kind: "square", side: 3 })],
  ["label", () => ({ kind: "label", text: "t", radius: "wide" })],
  ["circle with other key order", () => ({ radius: 4, kind: "circle" })],
];
for (const [label, make] of shapes) {
  show(label + " kind", () => wide.kind(make()));
  show(label + " isCircle", () => wide.isCircle(make()));
  show(label + " isNotCircle", () => wide.isNotCircle(make()));
  show(label + " radius", () => wide.radius(make()));
  show(label + " area", () => wide.area(make()));
  show(label + " guarded", () => wide.guarded(make()));
  show(label + " switched", () => wide.switched(make()));
  show(label + " grow", () => {
    const shape = make();
    wide.grow(shape);
    return shape;
  });
}
for (const value of [undefined, null, 0, 5, "", "text"]) {
  show(String(value) + " (" + typeof value + ") as undefined", () => wide.onlyUndefined(value));
  show(String(value) + " (" + typeof value + ") as null", () => wide.onlyNull(value));
}
for (const value of [true, false, 1, 0]) show(String(value) + " as true", () => wide.onlyTrue(value));
for (const value of [1, 2, 0, -0, NaN, 1.5]) show(String(value) + " as 1", () => wide.onlyOne(value));
