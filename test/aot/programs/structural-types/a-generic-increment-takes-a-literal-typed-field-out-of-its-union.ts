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

enum Level {
  Low,
  Mid,
  High,
}

interface Dial {
  step: 1 | 2 | 3;
  level: Level;
  bit: 0 | 1;
}

function bump<K extends string>(target: Record<K, number>, key: K): void {
  target[key] += 1;
}

function scale<K extends string>(target: Record<K, number>, key: K, by: number): void {
  target[key] *= by;
}

function nameOfStep(d: Dial): string {
  switch (d.step) {
    case 1:
      return "one";
    case 2:
      return "two";
    case 3:
      return "three";
  }
}

function nameOfLevel(d: Dial): string {
  if (d.level === Level.Low) return "low";
  if (d.level === Level.Mid) return "mid";
  if (d.level === Level.High) return "high";
  const never: never = d.level;
  return "never: " + show(never);
}

function flip(d: Dial): string {
  return d.bit === 0 ? "off" : "on";
}

const table: Record<1 | 2 | 3, string> = { 1: "first", 2: "second", 3: "third" };

function report(title: string, d: Dial): void {
  console.log(title + ": " + JSON.stringify(d));
  attempt("  step", () => nameOfStep(d));
  attempt("  typeof the name of the step", () => typeof nameOfStep(d));
  attempt("  level", () => nameOfLevel(d));
  attempt("  reverse mapping", () => Level[d.level]);
  attempt("  bit", () => flip(d));
  attempt("  table[step]", () => table[d.step]);
  attempt("  table[step].length", () => table[d.step].length);
  attempt("  step <= 3", () => d.step <= 3);
  attempt("  bit === 0 || bit === 1", () => d.bit === 0 || d.bit === 1);
}

const d: Dial = { step: 1, level: Level.Low, bit: 0 };
report("before", d);
bump(d, "step");
bump(d, "level");
bump(d, "bit");
report("one step up", d);
bump(d, "step");
bump(d, "level");
bump(d, "bit");
report("two steps up: the bit has left its union", d);
bump(d, "step");
bump(d, "level");
report("three steps up: all three have", d);
scale(d, "step", 0.5);
scale(d, "level", -1);
scale(d, "bit", 0);
report("fractions and negatives", d);
scale(d, "bit", -1);
scale(d, "step", NaN);
report("minus zero and not a number", d);
console.log("the bit is minus zero: " + Object.is(d.bit, -0));

export {};
