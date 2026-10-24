function show(value: unknown): string {
  if (typeof value === "number") return Object.is(value, -0) ? "-0" : String(value);
  if (typeof value === "string") return JSON.stringify(value);
  if (typeof value === "bigint") return String(value) + "n";
  if (typeof value === "function") return "function";
  if (typeof value !== "object" || value === null) return String(value);
  const parts: string[] = [];
  if (Array.isArray(value)) {
    const list: unknown[] = value;
    if (list.length > 40) return "array of " + list.length + " with keys " + Object.keys(list).join();
    for (let i = 0; i < list.length; i++) parts.push(i in list ? show(list[i]) : "<hole>");
    return "[" + parts.join(", ") + "]";
  }
  for (const [key, member] of Object.entries(value)) parts.push(key + ": " + show(member));
  return "{" + parts.join(", ") + "}";
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

class Point {
  x = 3;
  twice(): number {
    return this.x * 2;
  }
}

type State = [number, (next: number) => number];
type Located = [Point, number];
type Named = [string, Point];

function useState(start: number): State {
  let value = start;
  return [
    value,
    next => {
      value = next;
      return value;
    },
  ];
}

function apply(state: State): number {
  const [value, set] = state;
  return set(value + 1);
}

function callSecond(state: State): number {
  return state[1](5);
}

function locate(located: Located): number {
  return located[0].twice() + located[1];
}

function name(named: Named): string {
  return named[0].toUpperCase() + named[1].x;
}

let total = 0;
for (let i = 0; i < 2000; i++) total += apply(useState(i)) + callSecond(useState(i)) + locate([new Point(), i]) + name(["n", new Point()]).length;
console.log("2000 honest rounds: " + total);

const state = useState(1);
attempt("before", () => [typeof state[0], typeof state[1], apply(state), callSecond(state)]);
state.reverse();
console.log("reversed: " + typeof state[0] + " " + typeof state[1]);
attempt("  destructured and called", () => apply(state));
attempt("  the second is called", () => callSecond(state));
attempt("  the first + 1", () => typeof (state[0] + 1));
attempt("  the first * 2", () => state[0] * 2);
state.reverse();
attempt("reversed back", () => [apply(state), callSecond(state)]);

const located: Located = [new Point(), 4];
located.reverse();
console.log("a point and a number, reversed: " + typeof located[0] + " " + typeof located[1]);
attempt("  located", () => locate(located));
attempt("  [0].x", () => located[0].x);
attempt("  [0].twice()", () => located[0].twice());
attempt("  [1] + 1", () => typeof (located[1] + 1));
attempt("  [1] * 2", () => located[1] * 2);

const named: Named = ["n", new Point()];
named.reverse();
console.log("a string and a point, reversed: " + typeof named[0] + " " + typeof named[1]);
attempt("  named", () => name(named));
attempt("  [0].length", () => named[0].length);
attempt("  [1].x", () => named[1].x);
attempt("  [1].twice()", () => named[1].twice());

const popped = useState(1);
popped.pop();
attempt("the function is popped off and called", () => callSecond(popped));
attempt("the function is popped off and destructured", () => apply(popped));

export {};
