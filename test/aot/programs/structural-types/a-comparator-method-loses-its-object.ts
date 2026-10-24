function show(title: string, run: () => unknown): void {
  let result: string;
  try {
    const value = run();
    result = typeof value + " " + (Object.is(value, -0) ? "-0" : String(value));
  } catch (error) {
    result = error instanceof TypeError ? "threw a TypeError" : error instanceof ReferenceError ? "threw a ReferenceError" : "threw something else";
  }
  console.log(title + ": " + result);
}

class Sorter {
  direction: number = -1;
  key: "size" | "name" = "size";
  compare(a: number, b: number): number {
    return (a - b) * this.direction;
  }
  byKey(a: { size: number; name: string }, b: { size: number; name: string }): number {
    const x = a[this.key];
    const y = b[this.key];
    return x < y ? -1 : x > y ? 1 : 0;
  }
  static ascending(a: number, b: number): number {
    return a - b;
  }
  static flipped(a: number, b: number): number {
    return -this.ascending(a, b);
  }
}

const sorter = new Sorter();
const items = [
  { size: 2, name: "b" },
  { size: 1, name: "c" },
  { size: 3, name: "a" },
];

show("honest arrow", () => [1, 3, 2].sort((a, b) => sorter.compare(a, b)).join());
show("bound", () => [1, 3, 2].sort(sorter.compare.bind(sorter)).join());
show("bare", () => [1, 3, 2].sort(sorter.compare).join());
show("bare, one element", () => [1].sort(sorter.compare).join());
show("bare, no element", () => [].sort(sorter.compare).length);
show("bare toSorted", () => [1, 3, 2].toSorted(sorter.compare).join());
show("bare on a typed array", () => new Int8Array([1, 3, 2]).sort(sorter.compare).join());
show("byKey honest", () => [...items].sort((a, b) => sorter.byKey(a, b)).map(i => i.name).join());
show("byKey bare", () => [...items].sort(sorter.byKey).map(i => i.name).join());
show("static that needs no this", () => [1, 3, 2].sort(Sorter.ascending).join());
show("static that needs this", () => [1, 3, 2].sort(Sorter.flipped).join());
show("static that needs this, an arrow", () => [1, 3, 2].sort((a, b) => Sorter.flipped(a, b)).join());
const borrowed = { direction: 1, compare: sorter.compare };
show("borrowed by another object, an arrow", () => [1, 3, 2].sort((a, b) => borrowed.compare(a, b)).join());
show("the array is whole after a comparator that throws", () => {
  const list = [1, 3, 2];
  try {
    list.sort(sorter.compare);
  } catch (error) {
    return [...list].sort(Sorter.ascending).join();
  }
  return "did not throw";
});
