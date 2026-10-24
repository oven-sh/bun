function show(value: unknown): string {
  if (typeof value === "number") return Object.is(value, -0) ? "-0" : String(value);
  if (typeof value === "string") return JSON.stringify(value);
  if (typeof value === "bigint") return value + "n";
  if (typeof value === "symbol") return value.toString();
  if (typeof value === "function") return "function";
  if (typeof value !== "object" || value === null) return String(value);
  if (Array.isArray(value)) {
    const parts: string[] = [];
    for (let i = 0; i < value.length; i++) parts.push(i in value ? show(value[i]) : "hole");
    return "[" + parts.join(", ") + "]";
  }
  return "{" + Object.entries(value).map(([key, held]) => key + ": " + show(held)).join(", ") + "}";
}

function attempt(label: string, run: () => unknown): void {
  try {
    console.log(label, "->", show(run()));
  } catch (error) {
    console.log(label, "threw", error instanceof Error ? error.constructor.name : typeof error);
  }
}

enum Color {
  Red,
  Green,
  Blue,
}
enum Flag {
  None = 0,
  A = 1,
  B = 2,
}
enum Way {
  Up = "UP",
  Down = "DOWN",
}
type Shape = { kind: "circle"; radius: number } | { kind: "square"; side: number };
type Digit = 0 | 1 | 2;

const names: Record<Color, string> = { [Color.Red]: "red", [Color.Green]: "green", [Color.Blue]: "blue" };

function nameOf(color: Color): string {
  switch (color) {
    case Color.Red:
      return "red";
    case Color.Green:
      return "green";
    case Color.Blue:
      return "blue";
  }
}
function next(color: Color): Color {
  return color === Color.Blue ? Color.Red : color + 1;
}
function stepOf(way: Way): number {
  return way === Way.Up ? 1 : -1;
}
function area(shape: Shape): number {
  return shape.kind === "circle" ? shape.radius * shape.radius * 3 : shape.side * shape.side;
}
function has(flags: Flag, flag: Flag): boolean {
  return (flags & flag) !== 0;
}

class Pixel {
  color: Color = Color.Red;
  digit: Digit = 0;
  way: Way = Way.Up;
  turn(): this {
    this.color = next(this.color);
    this.digit = this.digit === 2 ? 0 : this.digit === 1 ? 2 : 1;
    this.way = this.way === Way.Up ? Way.Down : Way.Up;
    return this;
  }
}

const pixel = new Pixel();
let total = 0;
for (let i = 0; i < 2000; i++) {
  pixel.turn();
  total += nameOf(pixel.color).length + names[pixel.color].length + Color[pixel.color].length + pixel.digit + stepOf(pixel.way);
  total += area(i % 2 ? { kind: "circle", radius: i % 5 } : { kind: "square", side: i % 7 });
  total += has(i % 2 ? Flag.A : Flag.B, Flag.A) ? 1 : 0;
}
attempt("total", () => total);
attempt("the pixel", () => [pixel.color, pixel.digit, pixel.way, JSON.stringify(pixel), Object.keys(pixel)]);
attempt("colors", () => [Color.Red, Color.Green, Color.Blue].map(color => [color, nameOf(color), names[color], Color[color], next(color)]));
attempt("ways", () => [Way.Up, Way.Down].map(way => [way, stepOf(way)]));
attempt("shapes", () => [area({ kind: "circle", radius: 2 }), area({ kind: "square", side: 3 })]);
