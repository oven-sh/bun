function text(value: unknown): string {
  if (typeof value === "number") return "number " + (Object.is(value, -0) ? "-0" : String(value));
  if (typeof value === "bigint") return "bigint " + String(value);
  if (typeof value === "string") return "string " + JSON.stringify(value);
  if (typeof value === "function") return "function";
  if (Array.isArray(value)) return "[" + value.map(text).join(", ") + "]";
  if (typeof value === "object" && value !== null) return value.constructor.name + " " + JSON.stringify(value);
  return String(value);
}

function attempt(label: string, run: () => unknown): void {
  try {
    console.log(label + ": " + text(run()));
  } catch (error) {
    console.log(label + ": threw " + (error instanceof Error ? error.constructor.name : typeof error));
  }
}

class Unrelated {
  stored = "";
  get v(): number {
    return this.stored.length;
  }
  set v(text: string) {
    this.stored = text;
  }
}

class Leaf {
  weight = 7;
}

class Wraps {
  inner = new Leaf();
  get leaf(): Leaf {
    return this.inner;
  }
  set leaf(weight: number) {
    this.inner = new Leaf();
    this.inner.weight = weight;
  }
}

class Lists {
  items: number[] = [];
  get all(): number[] {
    return this.items;
  }
  set all(one: number) {
    this.items.push(one);
  }
}

class Calls {
  count = 0;
  get run(): () => number {
    return () => this.count;
  }
  set run(count: number) {
    this.count = count;
  }
}

attempt("a number out, a string in", () => {
  const u = new Unrelated();
  const stored = (u.v = "hello");
  return [stored, u.v, u.v + 1, u.v * 2];
});
attempt("plus equals joins the number and a string", () => {
  const u = new Unrelated();
  u.v = "hello";
  const result = (u.v += "!");
  return [result, u.stored, u.v];
});
attempt("after a store the type is the getter's", () => {
  const u = new Unrelated();
  u.v = "abc";
  const n: number = u.v;
  return [n, n.toFixed(1)];
});
attempt("an object out, a number in", () => {
  const w = new Wraps();
  const stored = (w.leaf = 3);
  return [stored, w.leaf, w.leaf.weight, w.leaf.weight + 1];
});
attempt("an array out, a number in", () => {
  const l = new Lists();
  l.all = 1;
  l.all = 2;
  return [l.all, l.all.length, l.all[1]];
});
attempt("a function out, a number in", () => {
  const c = new Calls();
  c.run = 5;
  return [typeof c.run, c.run(), c.run() + 1];
});
attempt("as a plain member of the getter's type", () => {
  const reader = (o: { readonly v: number }): number => o.v + 1;
  const u = new Unrelated();
  u.v = "four";
  return [reader(u), reader({ v: 1 })];
});
attempt("as a mutable member of the getter's type", () => {
  const writer = (o: { v: number }): unknown => {
    o.v = 12;
    return o.v;
  };
  const u = new Unrelated();
  return [writer({ v: 1 }), writer(u), typeof u.stored, u.stored];
});
attempt("the setter then meets a number", () => {
  const writer = (o: { v: number }): void => {
    o.v = 12;
  };
  const u = new Unrelated();
  writer(u);
  return u.v;
});
let sum = 0;
const one = new Unrelated();
for (let i = 0; i < 2000; i++) {
  one.v = i % 2 === 0 ? "ab" : "abc";
  sum += one.v;
}
console.log("2000 rounds: " + sum);
