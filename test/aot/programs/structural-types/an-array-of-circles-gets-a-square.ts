function show(value: unknown): string {
  if (typeof value === "number") return Object.is(value, -0) ? "-0" : String(value);
  if (typeof value === "string") return JSON.stringify(value);
  if (typeof value === "bigint") return String(value) + "n";
  if (typeof value === "symbol") return value.toString();
  if (typeof value === "function") return "function " + value.name;
  if (typeof value !== "object" || value === null) return String(value);
  const parts: string[] = [];
  if (Array.isArray(value)) {
    const list: unknown[] = value;
    for (let i = 0; i < list.length; i++) parts.push(i in list ? show(list[i]) : "<hole>");
    return "[" + parts.join(", ") + "]";
  }
  const entries: [string, unknown][] = Object.entries(value);
  for (const [key, member] of entries) parts.push(key + ": " + show(member));
  return (Object.getPrototypeOf(value) === null ? "no prototype" : value.constructor.name) + " {" + parts.join(", ") + "}";
}

function attempt(label: string, run: () => unknown): void {
  let line: string;
  try {
    line = show(run());
  } catch (error) {
    line = "threw " + (error instanceof Error ? error.constructor.name : show(error));
  }
  console.log(label + " -> " + line);
}

interface Circle {
  kind: "circle";
  radius: number;
}

interface Square {
  kind: "square";
  side: number;
}

type Shape = Circle | Square;

function radiusTimesTwo(circle: Circle): number {
  return circle.radius * 2;
}

function totalRadius(circles: Circle[]): number {
  let total = 0;
  for (const circle of circles) total += circle.radius;
  return total;
}

function kinds(circles: Circle[]): string {
  return circles.map(circle => circle.kind).join();
}

function allCircles(circles: Circle[]): boolean {
  return circles.every(circle => circle.kind === "circle");
}

function area(shape: Shape): number {
  switch (shape.kind) {
    case "circle":
      return shape.radius * shape.radius * 3;
    case "square":
      return shape.side * shape.side;
  }
}

function describe(circle: Circle): string {
  return circle.kind === "circle" ? "round " + circle.radius : "impossible";
}

let warm = 0;
for (let i = 0; i < 2000; i++) {
  const honest: Circle[] = [{ kind: "circle", radius: i }, { kind: "circle", radius: 0.5 }];
  warm += radiusTimesTwo(honest[0]) + totalRadius(honest) + kinds(honest).length + (allCircles(honest) ? 1 : 0) + area(honest[1]) + describe(honest[0]).length;
}
console.log("after 2000 honest arrays", warm);

const circles: Circle[] = [{ kind: "circle", radius: 1 }];
const shapes: Shape[] = circles;
shapes.push({ kind: "square", side: 2 });
circles.push({ kind: "circle", radius: 3 });

for (let index = 0; index < circles.length; index++) {
  attempt(index + ": radius * 2", () => radiusTimesTwo(circles[index]));
  attempt(index + ": kind", () => circles[index].kind);
  attempt(index + ": describe", () => describe(circles[index]));
  attempt(index + ": area", () => area(circles[index]));
  attempt(index + ": keys", () => Object.keys(circles[index]));
}
attempt("total radius", () => totalRadius(circles));
attempt("kinds", () => kinds(circles));
attempt("all circles", () => allCircles(circles));
attempt("the tag is rewritten through an alias", () => {
  const circle: Circle = { kind: "circle", radius: 2 };
  const tagged: { kind: "circle" | "square" } = circle;
  tagged.kind = "square";
  return [circle.kind, describe(circle), area(circle)];
});
attempt("the tag is rewritten through the array of shapes", () => {
  const list: Circle[] = [{ kind: "circle", radius: 2 }];
  const wide: { kind: Shape["kind"] }[] = list;
  wide[0].kind = "square";
  return [kinds(list), allCircles(list), area(list[0])];
});
attempt("a map of circles", () => {
  const byName = new Map<string, Circle>();
  const wide: Map<string, Shape> = byName;
  wide.set("box", { kind: "square", side: 2 });
  const found = byName.get("box");
  return found === undefined ? "missing" : [found.kind, found.radius, describe(found)];
});
