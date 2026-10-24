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

function count(v: number | number[]): number {
  return Array.isArray(v) ? v.length : v;
}

function total(v: number[] | ArrayLike<number>): number {
  if (Array.isArray(v)) return v.reduce((a, b) => a + b, 0);
  let sum = 0;
  for (let i = 0; i < v.length; i++) sum += v[i];
  return -sum;
}

function words(v: string | string[]): string {
  return Array.isArray(v) ? v.join("+") : v.toUpperCase();
}

function flat(v: number | (number | number[])[]): number {
  if (!Array.isArray(v)) return v;
  let sum = 0;
  for (const item of v) sum += Array.isArray(item) ? item.length * 100 : item;
  return sum;
}

function fixed(v: number[] | Set<number>): number {
  return Array.isArray(v) ? v.length : v.size * 10;
}

class Stack extends Array<number> {
  reduce(): number {
    return -1000;
  }
  join(): string {
    return "stack";
  }
}

attempt("honest", () => [count(5), count([1, 2]), total([1, 2]), total({ length: 2, 0: 1, 1: 2 }), words("a"), words(["a", "b"]), flat(1), flat([1, [2, 3]]), fixed([1]), fixed(new Set([1]))]);
let warm = 0;
for (let i = 0; i < 2000; i++) warm += count(i & 1 ? i : [i]) + total(i & 1 ? [i] : { length: 1, 0: i }) + words(i & 1 ? "a" : ["a"]).length + flat([i, [i]]);
console.log("2000 honest rounds", warm);

attempt("a typed array is array-like", () => total(new Uint8Array([1, 2])));
attempt("a string is array-like only in shape", () => {
  const letters: ArrayLike<string> = "ab";
  return [letters.length, letters[0], Array.isArray(letters)];
});
attempt("arguments", () => (function (a: number, b: number) { return total(arguments); })(1, 2));
attempt("a subclass that overrides reduce", () => {
  const s = new Stack();
  s.push(1, 2);
  return [total(s), Array.isArray(s), count(s)];
});
attempt("a proxy of an array", () => [total(new Proxy([1, 2], {})), count(new Proxy([1, 2], {}))]);
attempt("a proxy of an array that logs", () => total(new Proxy([1, 2], { get: (t, k, r) => (log.push(String(k)), Reflect.get(t, k, r)) })));
attempt("an array whose prototype was removed", () => {
  const list = [1, 2];
  Object.setPrototypeOf(list, null);
  return total(list);
});
attempt("an array-like whose prototype is Array.prototype", () => {
  const fake: ArrayLike<number> = Object.setPrototypeOf({ length: 2, 0: 1, 1: 2 }, Array.prototype);
  return [total(fake), Array.isArray(fake), fake instanceof Array];
});
attempt("holes", () => [total(new Array<number>(2)), flat(new Array<number>(2))]);
attempt("an array-like with a hole and a long length", () => total({ length: 3, 0: 123, 1: 456 }));
attempt("an array-like with a fraction for a length", () => total({ length: 1.5, 0: 1, 1: 2 }));
attempt("a frozen array", () => [total(Object.freeze([1, 2]))]);
attempt("a revoked proxy", () => {
  const { proxy, revoke } = Proxy.revocable([1, 2], {});
  revoke();
  return count(proxy);
});
attempt("honest again", () => [count(5), count([1, 2]), total([1, 2]), total({ length: 2, 0: 1, 1: 2 }), words(["a", "b"])]);
