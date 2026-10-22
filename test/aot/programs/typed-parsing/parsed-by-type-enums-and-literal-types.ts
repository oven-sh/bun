function show(value: unknown): string {
  if (typeof value === "number") return Object.is(value, -0) ? "-0" : String(value);
  if (typeof value === "string") return JSON.stringify(value);
  if (typeof value === "bigint") return value + "n";
  if (typeof value === "function") return "function";
  if (typeof value !== "object" || value === null) return String(value);
  if (Array.isArray(value)) {
    const parts: string[] = [];
    for (let i = 0; i < value.length; i++) parts.push(i in value ? show(value[i]) : "hole");
    return "[" + parts.join(", ") + "]";
  }
  const parent = Object.getPrototypeOf(value);
  const mark = parent === Object.prototype ? "" : parent === null ? "without a prototype " : "with another prototype ";
  return mark + "{" + Object.entries(value).map(([key, held]) => JSON.stringify(key) + ": " + show(held)).join(", ") + "}";
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
  Blue = 5,
}
enum Way {
  Up = "UP",
  Down = "DOWN",
}
interface Painted {
  color: Color;
  way: Way;
  size: "s" | "m" | "l";
  level: 1 | 2 | 3;
  on: true;
  none: null;
  id: `id-${number}`;
}

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
function describe(painted: Painted): unknown[] {
  return [nameOf(painted.color), Color[painted.color], painted.way === Way.Up ? "up" : "down", painted.size.toUpperCase(), painted.level + 1, painted.on ? "on" : "off", painted.none, painted.id.slice(3), JSON.stringify(painted)];
}

const texts = [
  '{"color":0,"way":"UP","size":"s","level":1,"on":true,"none":null,"id":"id-1"}',
  '{"color":1,"way":"DOWN","size":"m","level":2,"on":true,"none":null,"id":"id-2.5"}',
  '{"color":5,"way":"UP","size":"l","level":3,"on":true,"none":null,"id":"id--1"}',
  '{"color":5.0,"way":"\\u0055P","size":"\\u006c","level":3.0,"on":true,"none":null,"id":"id-1e3"}',
  '{"color":0.0,"way":"UP","size":"s","level":1e0,"on":true,"none":null,"id":"id-0"}',
  '{"color":50e-1,"way":"UP","size":"s","level":10e-1,"on":true,"none":null,"id":"id-\\u0031"}',
  '{"id":"id-7","none":null,"on":true,"level":2,"size":"m","way":"DOWN","color":1}',
];
for (const text of texts) attempt(text, () => describe(JSON.parse<Painted>(text)));
attempt("alone", () => [JSON.parse<Color>("5"), JSON.parse<Way>('"DOWN"'), JSON.parse<"s" | "m">('"m"'), JSON.parse<1 | 2>("2"), JSON.parse<true>("true"), JSON.parse<null>("null"), JSON.parse<Color.Green>("1")]);
attempt("lists", () => {
  const colors = JSON.parse<Color[]>("[0,1,5,5,0]");
  const ways = JSON.parse<Way[]>('["UP","DOWN","UP"]');
  return [colors.map(nameOf), ways.map(way => way === Way.Up), colors.indexOf(Color.Blue), ways.indexOf(Way.Down)];
});
attempt("as keys", () => {
  const table = JSON.parse<Record<Way, number>>('{"DOWN":2,"UP":1}');
  const byColor = JSON.parse<Record<Color, string>>('{"5":"b","0":"r","1":"g"}');
  return [table[Way.Up], table[Way.Down], Object.keys(table), byColor[Color.Blue], byColor[Color.Red], Object.keys(byColor)];
});
