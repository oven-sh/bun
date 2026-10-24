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

enum Odd {
  toString = 1,
  valueOf,
  constructor,
  hasOwnProperty,
  __proto__,
  length,
  name,
  prototype,
}

function plusOne(odd: Odd): number {
  return odd + 1;
}
function nameOf(odd: Odd): string {
  return Odd[odd];
}

attempt("members", () => [Odd.toString, Odd.valueOf, Odd.constructor, Odd.hasOwnProperty, Odd.__proto__, Odd.length, Odd.name, Odd.prototype]);
attempt("by quoted names", () => [Odd["toString"], Odd["constructor"], Odd["__proto__"], Odd["length"]]);
attempt("keys", () => Object.keys(Odd));
attempt("own names", () => Object.getOwnPropertyNames(Odd));
attempt("reverse", () => [Odd[1], Odd[2], Odd[3], Odd[4], Odd[5], Odd[6], Odd[7], Odd[8], Odd[9]]);
attempt("names of members", () => [nameOf(Odd.toString), nameOf(Odd.__proto__), nameOf(Odd.prototype)]);
attempt("plus one", () => [plusOne(Odd.toString), plusOne(Odd.__proto__), plusOne(Odd.length)]);
attempt("its prototype", () => Object.getPrototypeOf(Odd) === Object.prototype);
attempt("has its own", () => ["toString", "__proto__", "length", "isPrototypeOf"].map(key => Object.hasOwn(Odd, key)));
attempt("in", () => ["toString", "__proto__", "length", "isPrototypeOf"].map(key => key in Odd));
attempt("as a string", () => String(Odd));
attempt("in a template", () => `${Odd}`);
attempt("added to a string", () => "" + Odd);
attempt("as json", () => JSON.stringify(Odd));
attempt("entries", () => Object.entries(Odd));
attempt("read by names made at run time", () => {
  const table: Record<string, string | number> = { ...Odd };
  return ["to" + "String", "__" + "proto__", "len" + "gth"].map(key => table[key]);
});
