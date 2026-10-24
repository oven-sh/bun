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

function lengthOf(s: string): number {
  return s.length;
}

enum Level {
  Low = 1,
  Middle = lengthOf("ab"),
}

function highLevel(): Level {
  return Level.High;
}

function topLevel(): Level {
  return Level.Top;
}

function byName(name: "Low" | "Middle" | "High" | "Top"): Level {
  return Level[name];
}

show("between: a constant member of the second part", () => [Level.High, highLevel(), byName("High")]);
show("between: plus one", () => [Level.High + 1, highLevel() + 1, byName("High") + 1]);
show("between: a computed member of the second part", () => [Level.Top, topLevel(), byName("Top")]);
show("between: plus one", () => [Level.Top + 1, topLevel() + 1, byName("Top") + 1]);
show("between: names by number", () => [Level[1], Level[2], Level[10], Level[3]]);
show("between: keys", () => Object.keys(Level));

enum Level {
  High = 10,
  Top = lengthOf("abc"),
}

show("after: a constant member", () => [Level.High, highLevel(), byName("High")]);
show("after: a computed member", () => [Level.Top, topLevel(), byName("Top")]);
show("after: the first part", () => [Level.Low, Level.Middle, byName("Low"), byName("Middle")]);
show("after: names by number", () => [Level[1], Level[2], Level[10], Level[3]]);
show("after: keys", () => Object.keys(Level));

let sum = 0;
for (let i = 0; i < 2000; i++) sum += highLevel() + topLevel() + byName(i % 2 === 0 ? "Low" : "Top");
show("2000 reads", () => sum);
