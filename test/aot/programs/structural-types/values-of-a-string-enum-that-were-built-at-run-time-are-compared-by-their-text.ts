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
  Left = "LEFT",
}

enum Other {
  Up = "UP",
  Down = "down",
}

function isWay(text: string): text is Way {
  return text === Way.Up || text === Way.Down || text === Way.Left;
}

function nameOf(way: Way): string {
  switch (way) {
    case Way.Up:
      return "up";
    case Way.Down:
      return "down";
    case Way.Left:
      return "left";
  }
}

const steps: Record<Way, number> = { [Way.Up]: 1, [Way.Down]: -1, [Way.Left]: 0.5 };

function stepOf(way: Way): number {
  return steps[way];
}

function isUp(way: Way): boolean {
  return way === Way.Up;
}

function sameText(way: Way, other: Other): boolean {
  const left: string = way;
  const right: string = other;
  return left === right;
}

const pieces: string[] = JSON.parse('["U","P","DO","WN","L","E","F","T","up","UP ","ＵＰ"]');
const built: [string, string][] = [
  ["joined", [pieces[0], pieces[1]].join("")],
  ["added", pieces[2] + pieces[3]],
  ["added four times", pieces[4] + pieces[5] + pieces[6] + pieces[7]],
  ["raised", pieces[8].toUpperCase()],
  ["trimmed", pieces[9].trim()],
  ["sliced", ("x" + pieces[0] + pieces[1] + "y").slice(1, 3)],
  ["from codes", String.fromCharCode(85, 80)],
  ["repeated", (pieces[0] + pieces[1]).repeat(1)],
  ["in a template", `${pieces[2]}${pieces[3]}`],
  ["lower case", pieces[8]],
  ["with a space", pieces[9]],
  ["wide letters", pieces[10]],
  ["empty", pieces[0].slice(1)],
];

let warm = 0;
for (let i = 0; i < 2000; i++) {
  const way = i % 3 === 0 ? Way.Up : i % 3 === 1 ? Way.Down : Way.Left;
  warm += nameOf(way).length + stepOf(way) + (isUp(way) ? 1 : 0);
}
console.log("2000 honest rounds", warm);

const seen = new Map<Way, number>();
for (const [label, text] of built) {
  if (isWay(text)) {
    const way: Way = text;
    attempt(label + " is a way", () => [way, nameOf(way), stepOf(way), isUp(way), sameText(way, Other.Up), sameText(way, Other.Down), way in steps, Object.hasOwn(steps, way)]);
    seen.set(way, (seen.get(way) ?? 0) + 1);
  } else {
    attempt(label + " is no way", () => [text, text.length]);
  }
}
attempt("counted", () => [...seen.entries()]);
attempt("switch over a string with the members as cases", () =>
  built.map(([, text]) => {
    switch (text) {
      case Way.Up:
        return 1;
      case Way.Down:
        return 2;
      case Way.Left:
        return 3;
      default:
        return 0;
    }
  }),
);
attempt("a member is its literal", () => {
  const literal: "UP" = Way.Up;
  const text: string = Other.Up;
  return [literal, literal === text, literal.length];
});
