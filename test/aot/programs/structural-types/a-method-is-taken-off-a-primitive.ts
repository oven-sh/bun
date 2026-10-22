function show(value: unknown): string {
  if (typeof value === "number") return Object.is(value, -0) ? "-0" : String(value);
  if (typeof value === "string") return JSON.stringify(value);
  if (typeof value === "bigint") return String(value) + "n";
  if (typeof value === "symbol") return value.toString();
  if (typeof value === "function") return "function " + value.name;
  if (typeof value !== "object" || value === null) return String(value);
  const parts: string[] = [];
  if (Array.isArray(value)) {
    const list: unknown[] = value;
    for (let i = 0; i < list.length; i++) parts.push(i in list ? show(list[i]) : "<hole>");
    return "[" + parts.join(", ") + "]";
  }
  const entries: [string, unknown][] = Object.entries(value);
  for (const [key, member] of entries) parts.push(key + ": " + show(member));
  return (Object.getPrototypeOf(value) === null ? "no prototype" : value.constructor.name) + " {" + parts.join(", ") + "}";
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

type Fixable = { toFixed(digits: number): string };
type Sliceable = { slice(start: number, end?: number): { length: number } };
type Printable = { toString(): string };

function detachedToFixed(value: Fixable): string {
  const method = value.toFixed;
  return method(1);
}

function reattachedToFixed(value: Fixable): string {
  const method = value.toFixed;
  return method.call(value, 1);
}

function boundToFixed(value: Fixable): string {
  return value.toFixed.bind(value)(1);
}

function borrowedToFixed(from: Fixable, onto: Fixable): string {
  return from.toFixed.call(onto, 1);
}

function detachedSlice(value: Sliceable): number {
  const method = value.slice;
  return method(1).length;
}

function reattachedSlice(value: Sliceable): unknown {
  const method = value.slice;
  return method.call(value, 1);
}

function detachedToString(value: Printable): string {
  const method = value.toString;
  return method();
}

function methodName(value: Fixable): string {
  return value.toFixed.name + "/" + value.toFixed.length;
}

const own: Fixable = {
  toFixed(digits) {
    return "own " + digits + " " + (this === own) + " " + (this === undefined);
  },
};

let warm = 0;
for (let i = 0; i < 2000; i++) {
  warm += detachedToFixed(own).length + reattachedToFixed(own).length + boundToFixed(own).length + borrowedToFixed(own, own).length + methodName(own).length;
}
console.log("after 2000 literals", warm);

attempt("detached from a literal", () => detachedToFixed(own));
attempt("detached from a number", () => detachedToFixed(2.5));
attempt("detached from zero", () => detachedToFixed(0));
attempt("reattached to a literal", () => reattachedToFixed(own));
attempt("reattached to a number", () => reattachedToFixed(2.5));
attempt("bound to a number", () => boundToFixed(2.5));
attempt("bound to -0", () => boundToFixed(-0));
attempt("a number's method on a literal", () => borrowedToFixed(1, own));
attempt("a literal's method on a number", () => borrowedToFixed(own, 1));
attempt("a number's method on another number", () => borrowedToFixed(1, 7.75));
attempt("a number's method on a Number object", () => borrowedToFixed(1, new Number(7.75)));
attempt("name and length of a number's method", () => methodName(1));
attempt("slice detached from a string", () => detachedSlice("abc"));
attempt("slice detached from an array", () => detachedSlice([1, 2, 3]));
attempt("slice reattached to a string", () => reattachedSlice("abc"));
attempt("slice reattached to an array", () => reattachedSlice([1, 2, 3]));
attempt("slice reattached to a typed array", () => reattachedSlice(new Uint8Array([1, 2, 3])));
attempt("toString detached from a number", () => detachedToString(5));
attempt("toString detached from a string", () => detachedToString("abc"));
attempt("toString detached from a plain object", () => detachedToString(own));
attempt("toString detached from a function", () => detachedToString(methodName));
attempt("toString detached from an array", () => detachedToString([1]));
