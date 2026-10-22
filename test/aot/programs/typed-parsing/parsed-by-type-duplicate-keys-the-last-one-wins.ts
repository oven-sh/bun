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

interface Pair {
  a: number;
  b: string;
}
interface Nest {
  inner: { x: number };
  list: number[];
}

function sum(pair: Pair): string {
  return pair.a + 1 + pair.b;
}

const texts = [
  '{"a":1,"b":"x","a":2}',
  '{"a":1,"a":2,"b":"x"}',
  '{"a":"wrong","b":"x","a":3}',
  '{"a":null,"a":[],"a":{},"a":4,"b":"x"}',
  '{"b":1,"a":5,"b":"y"}',
  '{"a":6,"b":"x","b":"y","b":"z"}',
  '{"a":7,"b":"x","c":1,"c":2,"c":"three"}',
  '{"a":8,"\\u0061":9,"b":"x"}',
  '{"\\u0061":10,"a":11,"\\u0062":"escaped"}',
  '{"a":1.5,"b":"x","a":-0}',
];
for (const text of texts) {
  attempt(text, () => {
    const pair = JSON.parse<Pair>(text);
    return [pair, Object.keys(pair), sum(pair), JSON.stringify(pair), typeof pair.a, typeof pair.b];
  });
}
attempt("nested members twice", () => {
  const nest = JSON.parse<Nest>('{"inner":{"x":"wrong"},"list":"wrong","inner":{"x":1,"x":2},"list":[1],"list":[2,3]}');
  return [nest, nest.inner.x + 1, nest.list.length, Object.keys(nest)];
});
attempt("a thousand times", () => {
  let text = "{";
  for (let i = 0; i < 1000; i++) text += '"a":' + i + ",";
  const pair = JSON.parse<Pair>(text + '"b":"end"}');
  return [pair, sum(pair)];
});
