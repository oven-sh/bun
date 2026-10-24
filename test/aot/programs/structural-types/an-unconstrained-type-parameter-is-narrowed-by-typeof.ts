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

function twice<T>(value: T): T | number | string | bigint {
  if (typeof value === "number") return value + value;
  if (typeof value === "string") return value + value;
  if (typeof value === "bigint") return value + value;
  return value;
}

function sizeOf<T>(value: T): number {
  if (typeof value === "string") return value.length;
  if (typeof value === "number") return value | 0;
  if (typeof value === "function") return value.length;
  if (typeof value === "object" && value !== null) return Object.keys(value).length;
  return -1;
}

function at<T>(value: T, index: number): unknown {
  if (typeof value === "string") return value[index];
  if (Array.isArray(value)) return value[index];
  if (typeof value === "object" && value !== null && "length" in value) return value.length;
  return undefined;
}

function callIt<T>(value: T): unknown {
  if (typeof value === "function") return value();
  return "not called";
}

function truthy<T>(value: T): string {
  return value ? "truthy" : "falsy";
}

function same<T>(a: T, b: T): string {
  return (a === b) + " " + (a == b) + " " + Object.is(a, b);
}

function text<T>(value: T): string {
  return `${typeof value === "symbol" ? "a symbol" : value}`;
}

let total = 0;
for (let i = 0; i < 2000; i++) total += sizeOf(i) + sizeOf(twice(i)) + (truthy(i) === "truthy" ? 1 : 0);
console.log("2000 rounds with integers: " + total);

class Point {
  x = 1;
  y = 2;
}

function study<T>(title: string, value: T): void {
  console.log(title);
  attempt("  twice", () => twice(value));
  attempt("  size", () => sizeOf(value));
  attempt("  at 1", () => at(value, 1));
  attempt("  at 99", () => at(value, 99));
  attempt("  called", () => callIt(value));
  attempt("  truthy", () => truthy(value));
  attempt("  same", () => same(value, value));
}

study("an integer", 21);
study("a fraction", 1.75);
study("a large number", 2 ** 31);
study("minus zero", -0);
study("not a number", NaN);
study("a string", "ab");
study("an empty string", "");
study("a big integer", 2n ** 64n);
study("true", true);
study("null", null);
study("undefined", undefined);
study("a list", [5, 6, 7]);
study("a point", new Point());
study("a function", () => "was called");
study("a class", Point);
study("a string object", new String("ab"));
study("a number object", new Number(3));
study("an array-like", { length: 2, 0: "a", 1: "b" });
attempt("texts", () => [text(1), text(-0), text("s"), text(null), text(undefined), text([1, [2]]), text(1n), text(Symbol("s")), text({})]);
attempt("zero and minus zero", () => same(0, -0));
attempt("a number and a string at a wider type argument", () => same<number | string>(1, "1"));
attempt("null and undefined at a wider type argument", () => same<null | undefined>(null, undefined));

export {};
