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

declare enum Level {
  Promised = 10,
  AlsoPromised = 11,
}
enum Level {
  Made = 1,
  AlsoMade = 2,
}

enum Grade {
  Made = 1,
}
declare enum Grade {
  Promised = 5,
}

function promised(): Level {
  return Level.Promised;
}

function byName(name: "Promised" | "AlsoPromised" | "Made" | "AlsoMade"): Level {
  return Level[name];
}

function nameOf(level: Level): string {
  return Level[level];
}

show("typeof", () => [typeof Level, typeof Grade]);
show("what is made", () => [Level.Made, Level.AlsoMade, byName("Made"), nameOf(1)]);
show("what is promised, by a dot", () => [Level.Promised, Level.Promised + 1, promised()]);
show("what is promised, by a computed name", () => [byName("Promised"), byName("Promised") + 1, byName("AlsoPromised")]);
show("the name of what is promised", () => [nameOf(10), Level[10], nameOf(Level.Promised)]);
show("keys", () => Object.keys(Level));
show("in", () => ["Promised" in Level, "Made" in Level]);
show("in a switch", () => {
  const level: Level = byName("Made");
  switch (level) {
    case Level.Promised:
      return "promised";
    case Level.Made:
      return "made";
    default:
      return "neither";
  }
});
show("the declared part comes second", () => [Grade.Made, Grade.Promised, Grade.Promised + 1, Grade[5], Object.keys(Grade)]);

let sum = 0;
for (let i = 0; i < 2000; i++) sum += byName(i % 2 === 0 ? "Made" : "AlsoMade");
show("2000 honest reads", () => sum);
show("then a promised one", () => [byName("Promised"), byName("Promised") + 1]);
