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

interface Done {
  done: true;
  count: 1n;
  zero: 0;
  empty: "";
}

function isDone(state: Done): true {
  return state.done;
}
function doneText(state: Done): string {
  return state.done ? "done" : "not done";
}
function countOf(state: Done): 1n {
  return state.count;
}
function countIsOne(state: Done): boolean {
  return state.count === 1n;
}
function zeroText(state: Done): string {
  return state.zero ? "not zero" : "zero";
}
function emptyText(state: Done): string {
  return state.empty || "empty";
}
function look(state: Done): unknown[] {
  return [isDone(state), doneText(state), !state.done, countOf(state), countIsOne(state), state.count + 1n, state.zero, zeroText(state), state.zero + 1, state.empty, emptyText(state), state.empty.length, JSON.stringify({ ...state, count: String(state.count) })];
}
function make(): Done {
  return { done: true, count: 1n, zero: 0, empty: "" };
}

class Task implements Done {
  done: true = true;
  count: 1n = 1n;
  zero: 0 = 0;
  empty: "" = "";
}

interface Wide {
  done: boolean;
  count: bigint;
  zero: number;
  empty: string;
}
function overwrite(wide: Wide): void {
  wide.done = false;
  wide.count = -(2n ** 64n);
  wide.zero = 0.5;
  wide.empty = "full";
}

let warm = 0;
for (let i = 0; i < 2000; i++) warm += look(i % 2 ? make() : new Task()).length;
console.log("2000 honest rounds", warm);

attempt("a literal before", () => look(make()));
attempt("a literal after", () => {
  const state = make();
  overwrite(state);
  return look(state);
});
attempt("an instance before", () => look(new Task()));
attempt("an instance after", () => {
  const task = new Task();
  overwrite(task);
  return look(task);
});
attempt("elements", () => {
  const yes: true[] = [true, true];
  const wide: boolean[] = yes;
  wide[1] = false;
  const ones: 1n[] = [1n];
  const wideOnes: bigint[] = ones;
  wideOnes.push(0n);
  return [yes, yes.every(flag => flag), yes.map(flag => (flag ? 1 : 0)), ones, ones.map(one => one === 1n), ones.map(one => (one ? "truthy" : "falsy"))];
});
attempt("negative zero for zero", () => {
  const state = make();
  const wide: Wide = state;
  wide.zero = -0;
  return [state.zero, 1 / state.zero, state.zero === 0, Object.is(state.zero, 0), zeroText(state)];
});
