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

function make(length: number): number[] {
  return new Array<number>(length);
}

function makeByCall(length: number): number[] {
  return Array<number>(length);
}

function makeStrings(length: number): string[] {
  return new Array<string>(length);
}

function setLength(list: number[], length: number): number[] {
  list.length = length;
  return list;
}

function fromLength(length: number): number[] {
  return Array.from({ length }, (_, i) => i);
}

function view(length: number): number {
  return new Float64Array(length).length;
}

function describe(list: unknown[]): string {
  return "length " + list.length + ", 0 in it " + (0 in list) + ", typeof [0] " + typeof list[0] + ", keys " + Object.keys(list).join();
}

let warm = 0;
for (let i = 0; i < 2000; i++) warm += make(i % 5).length + makeByCall(2).length + makeStrings(1).length + setLength([1, 2, 3], i % 3).length + fromLength(2).length + view(3);
console.log("2000 honest rounds: " + warm);

const values: number[] = [];
const wide: unknown[] = values;
wide.push(3, "3", "three", "", null, true, false, [2], [], {}, { valueOf: () => 2 }, 2n);
const labels = ["three", "the text 3", "a word", "an empty text", "null", "true", "false", "a list with 2", "an empty list", "an object", "an object with valueOf", "a big integer", "past the end"];

for (let i = 0; i < labels.length; i++) {
  const length = values[i];
  console.log(labels[i]);
  attempt("  new Array", () => describe(make(length)));
  attempt("  Array", () => describe(makeByCall(length)));
  attempt("  new Array of strings", () => describe(makeStrings(length)));
  attempt("  length =", () => describe(setLength([1, 2, 3, 4], length)));
  attempt("  Array.from", () => describe(fromLength(length)));
  attempt("  a typed array", () => view(length));
}

export {};
