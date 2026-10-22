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
enum Way {
  Up = "UP",
  Down = "DOWN",
}

class Pixel {
  color: Color = Color.Red;
  on: boolean = false;
  digit: 0 | 1 | 2 = 0;
  way: Way = Way.Up;
  size: "s" | "m" = "s";
  after: number = 7;
}

function colorOf(pixel: Pixel): Color {
  return pixel.color;
}
function look(pixel: Pixel): unknown[] {
  return [
    colorOf(pixel),
    typeof pixel.color,
    pixel.color === Color.Red,
    Color[pixel.color],
    pixel.on,
    pixel.on ? "on" : "off",
    pixel.on === true,
    pixel.digit,
    pixel.digit === 0,
    pixel.way,
    pixel.way === Way.Up,
    pixel.size,
    pixel.size === "s",
    pixel.after,
    Object.keys(pixel).join(),
    JSON.stringify(pixel),
  ];
}

let warm = 0;
for (let i = 0; i < 2000; i++) {
  const pixel = new Pixel();
  pixel.color = i % 3;
  pixel.on = i % 2 === 0;
  pixel.digit = i % 2 ? 1 : 2;
  warm += look(pixel).length + pixel.color + pixel.digit;
}
console.log("2000 honest rounds", warm);

const values: unknown[] = [300, -1, 1.5, -0, NaN, 2 ** 31, "text", "", null, undefined, true, 0, 5n, [1], { a: 1 }];
const names = ["color", "on", "digit", "way", "size"];
for (const name of names) {
  for (const value of values) {
    attempt(name + " = " + show(value) + " by Reflect.set", () => {
      const pixel = new Pixel();
      Reflect.set(pixel, name, value);
      return typeof value === "bigint" ? look(pixel).slice(0, -1) : look(pixel);
    });
  }
}
attempt("all at once by Object.assign", () => {
  const pixel = new Pixel();
  Object.assign(pixel, { color: "red", on: 1, digit: 2.5, way: 0, size: null });
  return look(pixel);
});
attempt("all at once by defineProperty", () => {
  const pixel = new Pixel();
  for (const name of names) Object.defineProperty(pixel, name, { value: name.length * 100.5, writable: true, enumerable: true, configurable: true });
  return look(pixel);
});
attempt("all deleted", () => {
  const pixel = new Pixel();
  for (const name of names) Reflect.deleteProperty(pixel, name);
  return look(pixel);
});
attempt("typed stores afterwards", () => {
  const pixel = new Pixel();
  Object.assign(pixel, { color: "red", on: 1, digit: 2.5, way: 0, size: null });
  pixel.color = Color.Blue;
  pixel.on = true;
  pixel.digit = 2;
  pixel.way = Way.Down;
  pixel.size = "m";
  return look(pixel);
});
attempt("honest again", () => look(new Pixel()));
