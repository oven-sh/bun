type Shape = { kind: "circle"; r: number } | { kind: "square"; side: number } | { kind: "box"; w: number; h: number };

enum Color {
  Red,
  Green,
  Blue,
}

function show(value: unknown): string {
  if (typeof value === "number") return Object.is(value, -0) ? "-0" : String(value);
  if (typeof value === "string") return JSON.stringify(value);
  if (Array.isArray(value)) return "[" + value.map(show).join(", ") + "]";
  return String(value);
}

function attempt(label: string, run: () => unknown): void {
  try {
    console.log(label + " -> " + show(run()));
  } catch (error) {
    console.log(label + " threw " + (error instanceof Error ? error.constructor.name : typeof error));
  }
}

function area(s: Shape): number {
  switch (s.kind) {
    case "circle":
      return s.r * s.r * 3;
    case "square":
      return s.side * s.side;
    case "box":
      return s.w * s.h;
  }
}

function areaPlusOne(s: Shape): number {
  return area(s) + 1;
}

function named(s: Shape): string {
  if (s.kind === "circle") return "round";
  if (s.kind === "square") return "even";
  if (s.kind === "box") return "long";
  const rest: never = s;
  return "none of them: " + typeof rest + " " + JSON.stringify(rest);
}

function colorName(c: Color): string {
  switch (c) {
    case Color.Red:
      return "red";
    case Color.Green:
      return "green";
    case Color.Blue:
      return "blue";
  }
}

function yesOrNo(b: boolean): string {
  switch (b) {
    case true:
      return "yes";
    case false:
      return "no";
  }
}

function level(l: "low" | "high"): number {
  switch (l) {
    case "low":
      return 1;
    case "high":
      return 2;
  }
}

function kindOf(v: string | number): string {
  if (typeof v === "string") return "text " + v.length;
  if (typeof v === "number") return "number " + (v + 1);
  const rest: never = v;
  return "neither: " + typeof rest;
}

let warm = 0;
for (let i = 0; i < 2000; i++) {
  warm += area({ kind: "circle", r: i }) + area({ kind: "square", side: i }) + area({ kind: "box", w: i, h: 2 });
  warm += colorName(i % 3).length + yesOrNo(i % 2 === 0).length + level(i % 2 === 0 ? "low" : "high") + kindOf(i).length + named({ kind: "square", side: 1 }).length;
}
console.log("2000 honest rounds: " + warm);

const shapes = [
  '{"kind":"circle","r":2}',
  '{"kind":"triangle","r":2}',
  '{"kind":"Circle","r":2}',
  '{"kind":1,"r":2}',
  '{"kind":null}',
  "{}",
  '{"r":2,"kind":"circle"}',
  '{"kind":"circle"}',
  '{"kind":"circle","r":"2"}',
  '{"kind":"square","r":2}',
  '{"kind":"box","w":2}',
  '{"kind":["circle"],"r":2}',
  "[]",
  '"circle"',
  "5",
];
for (const text of shapes) {
  attempt("area of " + text, () => area(JSON.parse(text)));
  attempt("area plus one of " + text, () => areaPlusOne(JSON.parse(text)));
  attempt("name of " + text, () => named(JSON.parse(text)));
}
attempt("area of null", () => area(JSON.parse("null")));

for (const text of ["0", "2", "3", "-1", "1.5", '"1"', '"Red"', "null", "true", "[1]"]) {
  attempt("color " + text, () => colorName(JSON.parse(text)));
  attempt("color " + text + ", its length", () => colorName(JSON.parse(text)).length);
}
for (const text of ["true", "false", "1", "0", '"true"', "null", "[]"]) attempt("yes or no " + text, () => yesOrNo(JSON.parse(text)));
for (const text of ['"low"', '"high"', '"middle"', '""', "1", "null", '["low"]']) attempt("level " + text, () => [level(JSON.parse(text)), level(JSON.parse(text)) + 1]);
for (const text of ['"ab"', "1", "true", "null", "[1]", "{}"]) attempt("kind of " + text, () => kindOf(JSON.parse(text)));

console.log("honest again: " + [area({ kind: "circle", r: 1 }), named({ kind: "box", w: 1, h: 1 }), colorName(Color.Blue), yesOrNo(false), level("high"), kindOf("a")].join(" "));

export {};
