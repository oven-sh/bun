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

type Open = [number, ...string[]];
type Optional = [number, string?];
type Tail = [...number[], string];

function head(tuple: Open): number {
  return tuple[0] + 1;
}

function names(tuple: Open): string {
  const [, ...rest] = tuple;
  return rest.map(name => name.toUpperCase()).join();
}

function headOfOptional(tuple: Optional): number {
  return tuple[0] * 2;
}

function last(tuple: Tail): string {
  const [...all] = tuple;
  return typeof all[all.length - 1];
}

let total = 0;
for (let i = 0; i < 2000; i++) total += head([i, "a", "b"]) + names([i, "a"]).length + headOfOptional([i]) + last([i, "z"]).length;
console.log("2000 honest rounds: " + total);

const open: Open = [1, "a", "b"];
attempt("before", () => [show(open), head(open), names(open)]);
open.length = 2;
attempt("length = 2", () => [show(open), head(open), names(open)]);
open.length = 4;
attempt("length = 4: the list", () => show(open));
attempt("length = 4: head", () => head(open));
attempt("length = 4: names", () => names(open));
attempt("length = 4: [3]", () => [typeof open[3], 3 in open]);
open.length = 0;
attempt("length = 0: the list", () => show(open));
attempt("length = 0: typeof [0]", () => typeof open[0]);
attempt("length = 0: head", () => head(open));
attempt("length = 0: [0].toFixed", () => open[0].toFixed(1));
attempt("length = 0: destructured", () => {
  const [first, second] = open;
  return [typeof first, typeof second];
});
open.push("only a string");
attempt("then a string is pushed: the list", () => show(open));
attempt("then a string is pushed: head", () => head(open));
attempt("then a string is pushed: [0] * 2", () => open[0] * 2);

const optional: Optional = [1, "a"];
optional.length = 1;
attempt("an optional place is cut off", () => [show(optional), headOfOptional(optional), optional[1], optional.length]);
optional.length = 2;
attempt("and comes back as a hole", () => [show(optional), 1 in optional, optional[1]?.length]);

const tail: Tail = [1, 2, "z"];
tail.length = 2;
attempt("the string at the end is cut off", () => [show(tail), last(tail)]);
tail.length = 0;
attempt("everything is cut off", () => [show(tail), last(tail)]);

const wide: (number | string)[] = [];
const pair: [number, string] = [1, "a"];
const alias: (number | string)[] = pair;
alias.length = 0;
attempt("a closed tuple through a list type", () => [show(pair), pair.length, typeof pair[0], typeof pair[1], wide.length]);
attempt("a closed tuple through a list type: [0] + 1", () => pair[0] + 1);
attempt("a closed tuple through a list type: [1].length", () => pair[1].length);

export {};
