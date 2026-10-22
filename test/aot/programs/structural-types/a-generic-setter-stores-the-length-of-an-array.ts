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

function set<T, K extends keyof T>(target: T, key: K, value: T[K]): void {
  target[key] = value;
}

function sum(numbers: number[]): number {
  let total = 0;
  for (let i = 0; i < numbers.length; i++) total += numbers[i];
  return total;
}

function report(title: string, numbers: number[]): void {
  console.log(title + ": " + show(numbers) + " length " + numbers.length + " keys " + Object.keys(numbers).join());
  attempt("  sum", () => sum(numbers));
  attempt("  the last one", () => numbers[numbers.length - 1]);
  attempt("  the last one + 1", () => numbers[numbers.length - 1] + 1);
}

const numbers = [1, 2, 3, 4];
report("before", numbers);
set(numbers, "length", 2);
report("cut to 2", numbers);
set(numbers, "length", 4);
report("made 4 long again", numbers);
set(numbers, 3, 9);
report("the last place is stored to", numbers);
set(numbers, 6, 0.5);
report("a place past the end is stored to", numbers);
attempt("length -1", () => set(numbers, "length", -1));
attempt("length 1.5", () => set(numbers, "length", 1.5));
attempt("length NaN", () => set(numbers, "length", NaN));
attempt("length 2 ** 32", () => set(numbers, "length", 2 ** 32));
report("after four refused lengths", numbers);
set(numbers, "length", -0);
report("length minus zero", numbers);
set(numbers, -1, 5);
set(numbers, 1.5, 6);
report("places -1 and 1.5", numbers);
set(numbers, "length", 2 ** 32 - 1);
console.log("the longest: length " + numbers.length + " keys " + Object.keys(numbers).join());
attempt("  a push", () => numbers.push(1));
console.log("after the push: length " + numbers.length + " keys " + Object.keys(numbers).join());
set(numbers, "length", 0);
report("emptied", numbers);

const frozen = Object.freeze([1, 2, 3]);
const strings = ["a", "b", "c"];
set(strings, "length", 5);
attempt("strings made longer", () => [show(strings), strings[4], typeof strings[4]]);
attempt("strings made longer: a method of the last one", () => strings[4].length);
attempt("strings made longer: joined", () => strings.join("-"));
attempt("a frozen list is only read", () => [frozen.length, frozen[5]]);
const functions: (() => number)[] = [() => 1];
set(functions, "length", 2);
attempt("functions made longer: the last one is called", () => functions[1]());
attempt("functions made longer: all are called", () => functions.map(f => f()));
attempt("functions made longer: all are called by a loop", () => {
  let total = 0;
  for (let i = 0; i < functions.length; i++) total += functions[i]();
  return total;
});

export {};
