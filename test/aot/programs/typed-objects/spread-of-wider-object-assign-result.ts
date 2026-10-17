// Object.assign() returns its first argument typed as an intersection, so an object reaches a wider type
// without its own type ever being assigned to it. A spread of it followed by a property of the wider type must still work.
function show(o: unknown): string {
  return JSON.stringify(o) + " [" + Object.keys(o as object).join() + "]";
}
function row(name: string, f: () => unknown): void {
  let said: string;
  try {
    said = String(f());
  } catch (e) {
    said = "threw " + (e as Error).name;
  }
  console.log(name + ": " + said);
}

type Failures = { last: number | null; count: number };
type Fresh = { last: null; count: number };
function fresh(): Fresh {
  return { last: null, count: 0 };
}
function bump(f: Failures, n: number): Failures {
  return { ...f, last: n };
}
function merge(f: Failures, more: { last: number }): Failures {
  return { ...f, ...more };
}
const tag = Symbol("tag");

row("with a symbol key", () => {
  const copy = bump(Object.assign(fresh(), { [tag]: 1 }), 7);
  return show(copy) + " " + Object.getOwnPropertySymbols(copy).length + " " + String((copy as any)[tag]);
});
row("two spreads", () => show(merge(Object.assign(fresh(), { [tag]: 1 }), { last: 8 })));
row("the source is unchanged", () => {
  const source = Object.assign(fresh(), { [tag]: 1 });
  bump(source, 9);
  return show(source);
});
row("a copy of the copy", () => show(bump(bump(Object.assign(fresh(), { [tag]: 1 }), 1), 2)));
row("stored again later", () => {
  const copy = bump(Object.assign(fresh(), { [tag]: 1 }), 3);
  copy.last = null;
  copy.last = 4;
  return show(copy);
});
row("many times", () => {
  let sum = 0;
  for (let i = 0; i < 20000; i++) sum += bump(Object.assign(fresh(), { [tag]: i }), i).last!;
  return sum;
});
