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

const first: unique symbol = Symbol("key");
const second: unique symbol = Symbol("key");
const shared: unique symbol = Symbol.for("key");

interface Keyed {
  [first]: number;
  [second]?: string;
  plain: number;
}

function firstOf(keyed: Keyed): number {
  return keyed[first];
}
function secondOf(keyed: Keyed): string {
  return keyed[second] ?? "none";
}
function symbolsOf(value: object): string[] {
  return Object.getOwnPropertySymbols(value).map(symbol => (symbol === first ? "first" : symbol === second ? "second" : symbol === shared ? "shared" : "other"));
}

class Tagged implements Keyed {
  [first] = 1;
  plain = 2;
  get [second](): string {
    return "from a getter";
  }
}

let warm = 0;
for (let i = 0; i < 2000; i++) warm += firstOf({ [first]: i, plain: 0 }) + secondOf({ [first]: 0, [second]: "ab", plain: 0 }).length;
console.log("2000 honest rounds", warm);

attempt("told apart", () => [first === Symbol.for("key"), shared === Symbol.for("key"), first.description === second.description, first.toString()]);
attempt("a literal", () => {
  const keyed: Keyed = { plain: 1, [second]: "two", [first]: 3 };
  return [firstOf(keyed), secondOf(keyed), symbolsOf(keyed), Object.keys(keyed), JSON.stringify(keyed)];
});
attempt("an instance", () => {
  const tagged = new Tagged();
  return [firstOf(tagged), secondOf(tagged), symbolsOf(tagged), symbolsOf(Tagged.prototype), Object.keys(tagged)];
});
attempt("under another name", () => {
  const alias: typeof first = first;
  const keyed: Keyed = { [alias]: 5, plain: 0 };
  return [firstOf(keyed), keyed[alias], symbolsOf(keyed)];
});
attempt("a symbol with the same text is another member", () => {
  const extra = { [first]: 1, [shared]: 2, plain: 3 };
  const keyed: Keyed = extra;
  return [firstOf(keyed), secondOf(keyed), symbolsOf(keyed)];
});
attempt("stored by reflection", () => {
  const keyed: Keyed = { [first]: 1, plain: 0 };
  Reflect.set(keyed, first, "text");
  return [firstOf(keyed), typeof firstOf(keyed), firstOf(keyed) + 1];
});
attempt("deleted by reflection", () => {
  const keyed: Keyed = { [first]: 1, plain: 0 };
  Reflect.deleteProperty(keyed, first);
  return [firstOf(keyed), firstOf(keyed) + 1, first in keyed, symbolsOf(keyed)];
});
attempt("copied", () => {
  const keyed: Keyed = { [first]: 1, [second]: "s", plain: 0 };
  const spread: Keyed = { ...keyed };
  const assigned: Keyed = Object.assign({ [first]: 0, plain: 9 }, keyed);
  const cloned: Keyed = structuredClone(keyed);
  return [firstOf(spread), secondOf(spread), firstOf(assigned), firstOf(cloned), symbolsOf(cloned)];
});
