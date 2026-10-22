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

interface Size {
  width: number;
  height: number;
  scale: number;
}

function area(s: Size): number {
  return s.width * s.height * s.scale;
}

function report(title: string, s: Size): void {
  console.log(title + ": " + typeof s.width + " " + show(s.width) + ", " + typeof s.height + " " + show(s.height) + ", " + typeof s.scale + " " + show(s.scale) + ", keys " + Object.keys(s).join() + ", " + JSON.stringify(s));
  attempt("  area", () => area(s));
  attempt("  width + 1", () => s.width + 1);
  attempt("  width | 0", () => s.width | 0);
  attempt("  scale + 0.5", () => s.scale + 0.5);
  attempt("  width.toFixed(0)", () => s.width.toFixed(0));
  attempt("  'width' in it", () => "width" in s);
  attempt("  width === undefined", () => s.width === undefined);
}

const full: Size = { width: 2, height: 3, scale: 0.5 };

let total = 0;
for (let i = 0; i < 2000; i++) {
  const change: Partial<Size> = i % 2 === 0 ? { width: i } : { scale: i / 4 };
  const next: Size = { ...full, ...change };
  total += area(next);
}
console.log("2000 honest spreads: " + total);

const nothing: Partial<Size> = {};
const same: Size = { ...full, ...nothing };
report("an empty partial", same);

const blankWidth: Partial<Size> = { width: undefined };
const first: Size = { ...full, ...blankWidth };
report("width: undefined", first);

const blankScale: Partial<Size> = { scale: undefined, height: 7 };
const second: Size = { ...full, ...blankScale };
report("scale: undefined and a height", second);

const blankAll: Partial<Size> = { scale: undefined, height: undefined, width: undefined };
const third: Size = { ...full, ...blankAll };
report("all three undefined", third);

const onTop: Size = { ...blankAll, ...full };
report("the other way around: the partial's order of keys", onTop);

const twice: Size = { ...full, ...blankWidth, ...{ width: 9 } };
report("undefined and then a number", twice);

report("the full one was never touched", full);

export {};
