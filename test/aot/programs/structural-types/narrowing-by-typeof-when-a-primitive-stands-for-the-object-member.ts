function show(value: unknown): string {
  if (typeof value === "number") return Object.is(value, -0) ? "-0" : String(value);
  if (typeof value === "string") return JSON.stringify(value);
  if (typeof value === "bigint") return value + "n";
  if (value === null || value === undefined) return String(value);
  if (typeof value === "boolean") return String(value);
  if (Array.isArray(value)) {
    const parts: string[] = [];
    for (let i = 0; i < value.length; i++) parts.push(i in value ? show(value[i]) : "hole");
    return "[" + parts.join(", ") + "]";
  }
  return typeof value;
}

const log: string[] = [];

function attempt(label: string, run: () => unknown): void {
  log.length = 0;
  try {
    console.log(label, "->", show(run()), log.join(" "));
  } catch (error) {
    console.log(label, "threw", error instanceof Error ? error.constructor.name : typeof error, log.join(" "));
  }
}

function number(v: number | { valueOf(): number }): number {
  return typeof v === "number" ? v + 1 : v.valueOf() + 2;
}

function text(v: string | { toString(): string }): string {
  return typeof v === "string" ? v + "!" : v.toString() + "?";
}

attempt("honest number", () => [number(1), number({ valueOf: () => 1 })]);
attempt("honest text", () => [text("a"), text({ toString: () => "b" })]);
let warm = 0;
for (let i = 0; i < 2000; i++) warm += number(i & 1 ? i : { valueOf: () => i }) + text(i & 1 ? "a" : { toString: () => "b" }).length;
console.log("2000 honest rounds", warm);

attempt("a String object is a { toString }", () => text(new String("boxed")));
attempt("a Number object is a { valueOf }", () => number(new Number(5)));
attempt("a number is a { valueOf }", () => {
  const boxed: { valueOf(): number } = 5;
  return number(boxed);
});
attempt("a string is a { toString }", () => {
  const boxed: { toString(): string } = "plain";
  return text(boxed);
});
attempt("a number is a { toString }", () => text(5));
attempt("an array is a { toString }", () => text([1, 2]));
attempt("a date is a { valueOf }", () => number(new Date(5)));
attempt("honest again", () => [number(1), number({ valueOf: () => 1 }), text("a"), text({ toString: () => "b" })]);
