function show(value: unknown): string {
  if (typeof value === "number") return Object.is(value, -0) ? "-0" : String(value);
  if (typeof value === "string") return JSON.stringify(value);
  if (typeof value === "bigint") return String(value) + "n";
  if (typeof value === "symbol") return value.toString();
  if (typeof value === "function") return "function " + value.name;
  if (typeof value !== "object" || value === null) return String(value);
  const parts: string[] = [];
  if (Array.isArray(value)) {
    const list: unknown[] = value;
    for (let i = 0; i < list.length; i++) parts.push(i in list ? show(list[i]) : "<hole>");
    return "[" + parts.join(", ") + "]";
  }
  const entries: [string, unknown][] = Object.entries(value);
  for (const [key, member] of entries) parts.push(key + ": " + show(member));
  return (Object.getPrototypeOf(value) === null ? "no prototype" : value.constructor.name) + " {" + parts.join(", ") + "}";
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

function total<T extends ArrayLike<number>>(list: T): number {
  let sum = 0;
  for (let i = 0; i < list.length; i++) sum += list[i];
  return sum;
}

function lastOf<T>(list: ArrayLike<T>): T {
  return list[list.length - 1];
}

function toList<T>(list: ArrayLike<T>): T[] {
  const result: T[] = [];
  for (let i = 0; i < list.length; i++) result.push(list[i]);
  return result;
}

function same<T extends ArrayLike<unknown>>(list: T): T {
  return list;
}

function firstOf<T extends { [index: number]: number }>(list: T): number {
  return list[0] + 1;
}

function longer<T extends ArrayLike<unknown>>(a: T, b: T): T {
  return a.length >= b.length ? a : b;
}

class Section<T extends ArrayLike<number>> {
  constructor(private list: T, private start: number) {}
  read(offset: number): number {
    return this.list[this.start + offset];
  }
  sum(count: number): number {
    let sum = 0;
    for (let i = 0; i < count; i++) sum += this.read(i);
    return sum;
  }
}

let warm = 0;
for (let i = 0; i < 2000; i++) {
  const honest = [i, 2, 3];
  warm += total(honest) + lastOf(honest) + toList(honest).length + same(honest).length + firstOf(honest) + longer(honest, [1]).length + new Section(honest, 1).sum(2);
}
console.log("after 2000 arrays", warm);

attempt("total of an array", () => total([1, 2, 3]));
attempt("total of doubles", () => total([0.5, 0.25]));
attempt("total of bytes", () => total(new Uint8Array([200, 100])));
attempt("total of floats", () => total(new Float32Array([0.5, 0.25])));
attempt("total of a literal", () => total({ 0: 1, 1: 2, length: 2 }));
attempt("total of a literal that is too short", () => total({ 0: 1, length: 3 }));
attempt("total of holes", () => total(new Array<number>(2)));
attempt("total of a tuple", () => total([1, 2] satisfies [number, number]));
attempt("last of an array, a string, bytes, a literal", () => [lastOf([1, 2]), lastOf("xyz"), lastOf(new Uint8Array([7, 8])), lastOf({ 0: "only", length: 1 })]);
attempt("last of something empty", () => [lastOf([]), lastOf(""), lastOf(new Uint8Array(0)), lastOf({ length: 0 })]);
attempt("last of a literal that is too short, used as a number", () => lastOf<number>({ 0: 1, length: 2 }) + 1);
attempt("last of a literal that is too short, used as a string", () => lastOf<string>({ 0: "a", length: 2 }).length);
attempt("to a list", () => [toList("ab"), toList(new Int8Array([-1])), toList({ 1: true, length: 2 }), toList(new Array<number>(2))]);
attempt("the list made of holes has no holes", () => 0 in toList(new Array<number>(1)));
attempt("the same comes back", () => [same("text").toUpperCase(), same([1, 2]).concat(3), same(new Uint8Array(2)).byteLength]);
attempt("first of an array, a tuple, a literal, bytes", () => [firstOf([1]), firstOf([2, 3] satisfies [number, number]), firstOf({ 0: 3 }), firstOf(new Uint8Array([4]))]);
attempt("first of an empty array", () => {
  const empty: number[] = [];
  return firstOf(empty);
});
attempt("longer", () => [longer("ab", "abc"), longer([1, 2], [3]), longer<ArrayLike<unknown>>("ab", [1, 2, 3])]);
attempt("a window over an array", () => [new Section([1, 2, 3], 1).sum(2), new Section([1, 2, 3], 1).sum(3)]);
attempt("a window over bytes", () => [new Section(new Uint8Array([1, 2, 3]), 1).sum(2), new Section(new Uint8Array([1, 2, 3]), 1).sum(3)]);
attempt("a window that starts before the array", () => new Section([1, 2, 3], -1).read(0));
