function show(value: unknown): string {
  if (typeof value === "number") return Object.is(value, -0) ? "-0" : String(value);
  if (typeof value === "string") return JSON.stringify(value);
  if (typeof value === "bigint") return value + "n";
  if (typeof value === "function") return "function";
  if (typeof value !== "object" || value === null) return String(value);
  if (Array.isArray(value)) {
    const parts: string[] = [];
    for (let i = 0; i < value.length; i++) parts.push(i in value ? show(value[i]) : "hole");
    return "[" + parts.join(", ") + "]";
  }
  const parent = Object.getPrototypeOf(value);
  const mark = parent === Object.prototype ? "" : parent === null ? "without a prototype " : "with another prototype ";
  return mark + "{" + Object.entries(value).map(([key, held]) => JSON.stringify(key) + ": " + show(held)).join(", ") + "}";
}

function attempt(label: string, run: () => unknown): void {
  try {
    console.log(label, "->", show(run()));
  } catch (error) {
    console.log(label, "threw", error instanceof Error ? error.constructor.name : typeof error);
  }
}

interface Plain {
  id: number;
}
interface Named {
  constructor: string;
  toString: number;
  valueOf: boolean;
  hasOwnProperty: null;
}
interface WithProto {
  id: number;
  ["__proto__"]: { admin: boolean };
}

function idOf(plain: Plain): number {
  return plain.id;
}
function look(value: object): unknown[] {
  return [Object.keys(value), Object.getOwnPropertyNames(value), Object.getPrototypeOf(value) === Object.prototype, JSON.stringify(value), Object.hasOwn(value, "__proto__"), "admin" in value];
}

const extra = [
  '{"id":1,"__proto__":{"admin":true}}',
  '{"__proto__":{"admin":true},"id":2}',
  '{"id":3,"__proto__":null}',
  '{"id":4,"__proto__":5}',
  '{"id":5,"__proto__":[]}',
  '{"id":6,"constructor":1,"toString":2,"valueOf":3}',
  '{"id":7,"__proto__":{"id":99}}',
  '{"__proto__":{"__proto__":{"id":1}},"id":8}',
  '{"id":9,"__defineGetter__":1,"__lookupGetter__":2,"isPrototypeOf":3}',
];
for (const text of extra) {
  attempt(text, () => {
    const plain = JSON.parse<Plain>(text);
    return [plain, idOf(plain), look(plain)];
  });
}
attempt("an object with its own toString is written out", () => {
  const plain = JSON.parse<Plain>('{"id":6,"toString":2,"valueOf":3}');
  return String(plain);
});
attempt("declared names that every object inherits", () => {
  const named = JSON.parse<Named>('{"constructor":"c","toString":1,"valueOf":true,"hasOwnProperty":null}');
  return [named, named.constructor, named.toString + 1, named.valueOf, named.hasOwnProperty, look(named)];
});
attempt("a declared member named __proto__", () => {
  const value = JSON.parse<WithProto>('{"id":1,"__proto__":{"admin":true}}');
  return [value, value.id, look(value), Object.getOwnPropertyDescriptor(value, "__proto__")];
});
attempt("copies of an object with its own __proto__", () => {
  const plain = JSON.parse<Plain>('{"id":1,"__proto__":{"admin":true}}');
  const spread = { ...plain };
  const assigned = Object.assign({}, plain);
  return [look(spread), look(assigned), "admin" in assigned];
});
