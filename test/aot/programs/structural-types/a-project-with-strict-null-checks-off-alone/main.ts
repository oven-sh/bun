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

class Leaf {
  value: number = 1;
  next: Leaf = null;
  label: string = undefined;
  depth(): number {
    return this.next === null ? 1 : 1 + this.next.depth();
  }
}

function valueOf(l: Leaf): number {
  return l.value + 1;
}

function nextValue(l: Leaf): number {
  return l.next.value;
}

function labelSize(l: Leaf): number {
  return l.label.length;
}

function first(list: Leaf[]): Leaf {
  return list[0];
}

function lookUp(m: Map<string, number>, key: string): number {
  return m.get(key) + 1;
}

function matched(text: string): string {
  return /\d+/.exec(text)[0];
}

function orDefault(n: number): number {
  return n ?? 10;
}

function isNull(n: number): boolean {
  return n === null;
}

function chain(): Leaf {
  const a = new Leaf();
  a.next = new Leaf();
  a.label = "a";
  return a;
}

attempt("honest", () => [valueOf(chain()), nextValue(chain()), labelSize(chain()), chain().depth(), first([chain()]).value, lookUp(new Map([["a", 1]]), "a"), matched("a12"), orDefault(1), isNull(1)]);
let warm = 0;
for (let i = 0; i < 2000; i++) warm += valueOf(chain()) + nextValue(chain()) + labelSize(chain()) + chain().depth() + orDefault(i);
console.log("2000 honest rounds", warm);

attempt("null for a leaf", () => valueOf(null));
attempt("undefined for a leaf", () => valueOf(undefined));
attempt("next is null", () => nextValue(new Leaf()));
attempt("label is undefined", () => labelSize(new Leaf()));
attempt("an empty list", () => first([]));
attempt("an empty list, then a field", () => first([]).value);
attempt("no such key", () => lookUp(new Map(), "a"));
attempt("no match", () => matched("abc"));
attempt("a default for null and undefined", () => [orDefault(null), orDefault(undefined), orDefault(0), orDefault(NaN)]);
attempt("compared with null", () => [isNull(null), isNull(undefined), isNull(0)]);
attempt("null in arithmetic", () => {
  const n: number = null;
  const u: number = undefined;
  return [n + 1, u + 1, n * 2, -n, n | 0, u | 0, n < 1, u < 1, n == u, n === u];
});
attempt("null in a list of numbers", () => {
  const list: number[] = [1, null, undefined, 2];
  let sum = 0;
  for (const n of list) sum += n;
  return [sum, list, list.map(n => n + 1), list.indexOf(null), list.includes(undefined)];
});
attempt("null in a template and in JSON", () => {
  const s: string = null;
  const o: { s: string; u: string; n: number } = { s, u: undefined, n: null };
  return [`${s}`, s + "", JSON.stringify(o), Object.keys(o)];
});
attempt("null narrowed away by nothing", () => {
  const pick = (flag: boolean): Leaf => (flag ? new Leaf() : null);
  return [pick(true).value, typeof pick(false)];
});
attempt("optional chaining where the type says it is never needed", () => {
  const l: Leaf = null;
  return [l?.value, l?.next?.value, new Leaf().next?.value];
});
attempt("honest again", () => [valueOf(chain()), nextValue(chain()), labelSize(chain()), chain().depth()]);
