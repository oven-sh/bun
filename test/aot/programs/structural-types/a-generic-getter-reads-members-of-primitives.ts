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

function get<T, K extends keyof T>(target: T, key: K): T[K] {
  return target[key];
}

function has<T>(target: T, key: keyof T): boolean {
  return target[key] !== undefined;
}

function callMember<T, K extends keyof T>(target: T, key: K, use: (member: T[K], target: T) => unknown): unknown {
  return use(target[key], target);
}

let total = 0;
for (let i = 0; i < 2000; i++) total += get({ a: i, b: "s" }, "a") + get({ a: i, b: "s" }, "b").length + get([i, 1], 0) + get([i], "length");
console.log("2000 rounds with objects and lists: " + total);

attempt("the length of a string", () => get("abc", "length") + 1);
attempt("a letter of a string", () => get("abc", 1).toUpperCase());
attempt("a letter past the end", () => typeof get("abc", 99));
attempt("a letter past the end: a method", () => get("abc", 99).toUpperCase());
attempt("a method of a string", () => typeof get("abc", "toUpperCase"));
attempt("a method of a string, called on it", () => callMember("abc", "toUpperCase", (member, target) => member.call(target)));
attempt("a method of a string, called bare", () => get("abc", "toUpperCase")());
attempt("a method of a number", () => typeof get(5, "toFixed"));
attempt("a method of a number, called on it", () => callMember(5.25, "toFixed", (member, target) => member.call(target, 1)));
attempt("a method of a number, called bare", () => get(5, "toFixed")(1));
attempt("a method of a boolean", () => callMember(true, "valueOf", (member, target) => member.call(target)));
attempt("a method of a big integer", () => callMember(5n, "toString", (member, target) => member.call(target)));
attempt("the description of a symbol", () => get(Symbol("s"), "description"));
attempt("has", () => [has("abc", "length"), has("abc", 0), has("abc", 5), has(5, "toFixed"), has([1], 0), has([1], 1), has({ a: undefined }, "a")]);
attempt("an element past the end of a list", () => [typeof get([1, 2], 99), get([1, 2], 99) + 1]);
attempt("an element at minus one", () => typeof get([1, 2], -1));
attempt("a place of a tuple", () => {
  const tuple: [number, string] = [1, "a"];
  return [get(tuple, 0) + 1, get(tuple, 1).toUpperCase(), get(tuple, "length")];
});
attempt("the name and the length of a function", () => {
  const one: Function = (a: number) => a;
  const other: Function = function named() {};
  return [get(one, "length"), get(other, "name")];
});
attempt("a static member of a class", () => {
  class Point {
    static origin = 7;
  }
  return [get(Point, "origin") + 1, typeof get(Point, "prototype")];
});
attempt("a union of a string and a list", () => {
  const either: string | number[] = process.argv.length > 0 ? "abc" : [1, 2];
  return get(either, "length");
});
attempt("a union of a number and a string: what both have", () => {
  const either: number | string = process.argv.length > 0 ? 5 : "five";
  return callMember(either, "toString", (member, target) => member.call(target));
});

export {};
