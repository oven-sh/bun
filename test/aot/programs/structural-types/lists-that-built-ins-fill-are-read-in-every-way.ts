function show(value: unknown): string {
  if (typeof value === "number") return Object.is(value, -0) ? "-0" : String(value);
  if (typeof value === "string") return JSON.stringify(value);
  if (typeof value === "bigint") return value + "n";
  if (typeof value === "function") return "function";
  if (Array.isArray(value)) {
    const parts: string[] = [];
    for (let i = 0; i < value.length; i++) parts.push(i in value ? show(value[i]) : "hole");
    return "[" + parts.join(", ") + "]";
  }
  if (typeof value === "object" && value !== null) return "{" + Object.keys(value).join() + "}";
  return String(value);
}

function attempt(label: string, run: () => unknown): void {
  try {
    console.log(label + " -> " + show(run()));
  } catch (error) {
    console.log(label + " threw " + (error instanceof Error ? error.constructor.name : typeof error));
  }
}

function total(numbers: Iterable<number>): number {
  let result = 0;
  for (const n of numbers) result += n;
  return result;
}

attempt("what splice returns", () => {
  const list = [1, 2, 3, 4];
  const removed = list.splice(1, 2);
  return [removed, removed[0] + 1, total(removed), list, removed.length];
});
attempt("concat", () => {
  const joined = [1].concat([2, 3], 4, [[5]].flat());
  return [joined, total(joined), joined[4] + 1];
});
attempt("keys and entries", () => {
  const keys = [...["a", "b"].keys()];
  const entries = [...["a", "b"].entries()];
  return [total(keys), entries[1][0] + 1, entries[1][1].length];
});
attempt("lists made from lengths", () => {
  const counted = [...Array(3).keys()];
  const filled = Array(3).fill(0).map((_, i) => i * 2);
  const applied = Array.apply(null, Array(2));
  const from = Array.from({ length: 3 }, (_, i) => i + 1);
  return [total(counted), total(filled), applied, 0 in applied, total(from)];
});
attempt("a list from an array-like, an iterator and arguments", () => {
  const like = Array.from({ length: 2, 0: "a", 1: "b" });
  const iterated = Array.from(new Set([1, 2]).values());
  function collect(...rest: number[]): number[] {
    return Array.prototype.slice.call(arguments, 1);
  }
  return [like.map(s => s.length), total(iterated), collect(1, 2, 3), total(collect(1, 2, 3))];
});
attempt("fill with one object", () => {
  const list = Array.from({ length: 2 }).fill({ n: 1 });
  const typed: { n: number }[] = new Array<{ n: number }>(2).fill({ n: 1 });
  typed[0].n = 5;
  return [list.length, typed[1].n, typed[0] === typed[1]];
});
attempt("in place and the same list back", () => {
  const list = [3, 1, 2];
  const sorted = list.sort();
  const reversed = list.reverse();
  const copied = list.copyWithin(0, 1);
  return [sorted === list, reversed === list, copied === list, list, total(copied)];
});
attempt("names, symbols and descriptors", () => {
  const key = Symbol("k");
  const object = { a: 1, b: "two", [key]: 3 };
  const names = Object.getOwnPropertyNames(object);
  const symbols = Object.getOwnPropertySymbols(object);
  const own = Reflect.ownKeys(object);
  const descriptors = Object.getOwnPropertyDescriptors(object);
  return [names.map(name => name.length), symbols.length, symbols[0] === key, own.length, typeof own[2], descriptors.a.value, descriptors.b.writable, Object.keys(descriptors).join()];
});
attempt("entries of a list, a text and a map", () => [Object.entries([7, 8]), Object.entries("ab"), Object.entries(new Map([[1, 2]])), Object.keys("ab"), Object.values("ab")]);
attempt("entries of an instance", () => {
  class Pixel {
    x = 1;
    y = 2;
    sum(): number {
      return this.x + this.y;
    }
  }
  const entries = Object.entries(new Pixel());
  let result = 0;
  for (const [name, n] of entries) result += name.length + n;
  return [entries, result, total(Object.values(new Pixel()))];
});
attempt("a list of lists, flattened", () => {
  const flat = [[1, 2], [3]].flat();
  const mapped = [1, 2].flatMap(n => [n, [n]]);
  const deep = [1, [2, [3, [4]]]].flat(Infinity);
  return [total(flat), mapped, deep, deep.length];
});
attempt("what reduce builds", () => {
  const byParity = [1, 2, 3].reduce<Record<string, number[]>>((groups, n) => {
    (groups[n % 2 ? "odd" : "even"] ??= []).push(n);
    return groups;
  }, {});
  const pairs = [1, 2].reduce<[number, string][]>((list, n) => [...list, [n, String(n)]], []);
  return [byParity.odd, byParity.even, Object.keys(byParity).join(), pairs[1][0] + 1, pairs[1][1].length];
});
attempt("iterator helpers", () => {
  const source = [1, 2, 3, 4];
  return [
    source.values().map(n => n * 2).toArray(),
    source.values().filter(n => n % 2 === 0).toArray(),
    source.values().drop(1).take(2).toArray(),
    source.values().flatMap(n => [n, n]).toArray().length,
    source.values().reduce((a, b) => a + b),
    source.values().some(n => n > 3),
    source.values().find(n => n > 2),
    total(Iterator.from(new Set([1, 2])).map(n => n + 1)),
  ];
});
attempt("zipped by hand with entries", () => {
  const names = ["a", "b"];
  const sizes = [1, 2];
  const zipped = names.map((name, i): [string, number] => [name, sizes[i]]);
  const object: Record<string, number> = {};
  for (const [name, size] of zipped) object[name] = size;
  return [zipped, object.a + object.b, Object.entries(object)];
});

export {};
