function text(value: unknown): string {
  if (typeof value === "number") return "number " + (Object.is(value, -0) ? "-0" : String(value));
  if (typeof value === "object" && value !== null) return "object " + JSON.stringify(value);
  return typeof value + " " + String(value);
}

function failure(error: unknown): string {
  return "threw " + (error instanceof Error ? error.constructor.name : text(error));
}

function attempt(label: string, run: () => unknown): void {
  try {
    console.log(label + ": " + text(run()));
  } catch (error) {
    console.log(label + ": " + failure(error));
  }
}

type Line = [kind: "line", x: number, y: number];
type Circle = [kind: "circle", radius: number];
type Stop = [kind: "stop"];
type Move = Line | Circle | Stop;

function draw(...move: Move): string {
  const seen = move.length + " given: " + move.map(text).join(", ") + " -> ";
  switch (move[0]) {
    case "line":
      return seen + "line to " + text(move[1] + move[2]);
    case "circle":
      return seen + "circle of " + text(move[1] * 2);
    case "stop":
      return seen + "stop";
  }
}

function byLength(...move: Move): string {
  if (move.length === 3) return "three: " + text(move[1] + move[2]);
  if (move.length === 2) return "two: " + text(move[1].toFixed(1));
  return "one: " + move[0].toUpperCase();
}

function named(...[kind, first = -1, second = -2]: Move): string {
  return text(kind) + " " + text(first) + " " + text(second);
}

function mixed(...parts: [id: number, note?: string, ...flags: boolean[]]): string {
  const [id, note, ...flags] = parts;
  return parts.length + " | " + text(id) + " | " + text(note) + " | " + text(flags) + " | " + (note === undefined ? "no note" : text(note.length));
}

attempt("honest line", () => draw("line", 1, 2));
attempt("honest circle", () => draw("circle", 3));
attempt("honest stop", () => draw("stop"));

const functions: [string, (...move: Move) => string][] = [
  ["draw", draw],
  ["by length", byLength],
  ["named", named],
];

const changes: [string, (line: Line) => void][] = [
  ["untouched", () => {}],
  ["popped", line => void line.pop()],
  ["popped twice", line => {
    line.pop();
    line.pop();
  }],
  ["emptied by splice", line => void line.splice(0)],
  ["pushed", line => void line.push(9)],
  ["reversed", line => void line.reverse()],
  ["shifted", line => void line.shift()],
  ["sorted", line => void line.sort()],
  ["filled", line => void line.fill(7, 1)],
  ["a hole", line => void Reflect.deleteProperty(line, 1)],
  ["the kind of a circle by copyWithin", line => void line.copyWithin(0, 1)],
];

for (const [name, f] of functions) {
  for (const [label, change] of changes) {
    const line: Line = ["line", 1, 2];
    change(line);
    attempt(name + ", " + label, () => f(...line));
    attempt(name + ", " + label + ", by apply", () => f.apply(null, line));
  }
}

let warm = 0;
for (let i = 0; i < 2000; i++) warm += draw("line", i, 1).length + draw("circle", i).length + draw("stop").length;
console.log("2000 honest rounds: " + warm);
const late: Circle = ["circle", 4];
late.pop();
attempt("a circle without a radius after them", () => draw(...late));

attempt("mixed(1)", () => mixed(1));
attempt("mixed(1, undefined)", () => mixed(1, undefined));
attempt("mixed(1, 'n')", () => mixed(1, "n"));
attempt("mixed(1, 'n', true, false)", () => mixed(1, "n", true, false));
attempt("mixed(1, undefined, true)", () => mixed(1, undefined, true));
const parts: [number, string?, ...boolean[]] = [1, "n", true];
parts.reverse();
attempt("mixed, reversed", () => mixed(...parts));
parts.length = 0;
attempt("mixed, emptied", () => mixed(...parts));

const moves: Move[] = [["line", 1, 2], ["circle", 3], ["stop"]];
attempt("a list of moves", () => moves.map(move => draw(...move)));
for (const move of moves) move.reverse();
attempt("the list, each reversed", () => moves.map(move => draw(...move)));
