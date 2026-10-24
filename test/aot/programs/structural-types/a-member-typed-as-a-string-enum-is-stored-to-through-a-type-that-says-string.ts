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

enum Way {
  Up = "UP",
  Down = "DOWN",
}

interface Move {
  way: Way;
  by: number;
}

function nameOf(way: Way): string {
  switch (way) {
    case Way.Up:
      return "up";
    case Way.Down:
      return "down";
  }
}

function signOf(move: Move): number {
  return move.way === Way.Up ? move.by : move.way === Way.Down ? -move.by : fail(move.way);
}

function fail(value: never): number {
  console.log("  reached with", show(value));
  return 0;
}

const table: Record<Way, number> = { [Way.Up]: 1, [Way.Down]: 2 };

function rename(target: { way: string }, text: string): void {
  target.way = text;
}

class Walker {
  way: Way = Way.Up;
  describe(): string {
    return nameOf(this.way) + " " + table[this.way];
  }
}

let warm = 0;
for (let i = 0; i < 2000; i++) {
  const move: Move = { way: i % 2 ? Way.Up : Way.Down, by: i };
  warm += signOf(move) + nameOf(move.way).length;
}
console.log("2000 honest rounds", warm);

for (const text of ["SIDEWAYS", "up", "", "UP", "DOWN", "constructor", "0"]) {
  attempt(show(text) + " in a literal", () => {
    const move: Move = { way: Way.Up, by: 3 };
    rename(move, text);
    return [move.way, nameOf(move.way), signOf(move), table[move.way], typeof table[move.way], JSON.stringify(move)];
  });
  attempt(show(text) + " in a literal, the name is used", () => {
    const move: Move = { way: Way.Down, by: 3 };
    rename(move, text);
    return nameOf(move.way).length;
  });
  attempt(show(text) + " in an instance", () => {
    const walker = new Walker();
    rename(walker, text);
    return [walker.way, walker.describe(), walker.way === Way.Up, walker.way === Way.Down];
  });
  attempt(show(text) + " in an element", () => {
    const ways: Way[] = [Way.Up, Way.Down];
    const texts: string[] = ways;
    texts.push(text);
    return [ways, ways.map(nameOf), ways.map(way => table[way])];
  });
}
attempt("honest again", () => [signOf({ way: Way.Down, by: 2 }), new Walker().describe()]);
