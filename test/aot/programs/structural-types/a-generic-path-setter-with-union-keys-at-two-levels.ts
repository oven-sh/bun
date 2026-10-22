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

interface Tree {
  left: { depth: number; tag: string };
  right: { depth: number; tag: string };
  meta: { depth: string; tag: number };
}

function setIn<T, A extends keyof T, B extends keyof T[A]>(target: T, a: A, b: B, value: T[A][B]): void {
  target[a][b] = value;
}

function getIn<T, A extends keyof T, B extends keyof T[A]>(target: T, a: A, b: B): T[A][B] {
  return target[a][b];
}

function depths(t: Tree): number {
  return t.left.depth + t.right.depth;
}

function tags(t: Tree): string {
  return t.left.tag.toUpperCase() + t.right.tag.toUpperCase();
}

function meta(t: Tree): string {
  return t.meta.depth.toUpperCase() + (t.meta.tag + 1);
}

const yes: boolean = process.argv.length > 0;

function fresh(): Tree {
  return { left: { depth: 1, tag: "l" }, right: { depth: 2, tag: "r" }, meta: { depth: "deep", tag: 5 } };
}

function report(title: string, t: Tree): void {
  console.log(title + ": " + JSON.stringify(t));
  attempt("  depths", () => depths(t));
  attempt("  tags", () => tags(t));
  attempt("  meta", () => meta(t));
}

let total = 0;
const warm = fresh();
for (let i = 0; i < 2000; i++) {
  setIn(warm, "left", "depth", i);
  setIn(warm, "right", "tag", "r" + (i % 3));
  setIn(warm, "meta", "tag", i);
  total += depths(warm) + tags(warm).length + meta(warm).length + getIn(warm, "left", "depth");
}
console.log("2000 honest rounds: " + total);

const a = fresh();
setIn(a, "left", yes ? "depth" : "tag", "inner union");
report("the inner key is a union", a);

const b = fresh();
setIn(b, yes ? "left" : "meta", "depth", "outer union");
report("the outer key is a union: a string into a number", b);

const c = fresh();
setIn(c, yes ? "meta" : "left", "depth", 9);
report("the outer key is a union: a number into a string", c);

const d = fresh();
setIn(d, yes ? "right" : "meta", yes ? "tag" : "depth", 3);
report("both keys are unions", d);

const e = fresh();
attempt("read with an outer union", () => {
  const value = getIn(e, yes ? "meta" : "left", "depth");
  return [typeof value, value];
});
report("never touched", e);

export {};
