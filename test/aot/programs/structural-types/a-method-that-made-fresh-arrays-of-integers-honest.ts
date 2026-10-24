class Table {
  row(): number[] {
    return [1, 2, 3];
  }
}

class Noisy extends Array<number> {
  push(...items: number[]): number {
    return super.push(...items.map(n => n * 100));
  }
}

const shared = [7, 8, 9];

function show(list: number[]): string {
  const parts: string[] = [];
  for (let i = 0; i < list.length; i++) parts.push(i in list ? (Object.is(list[i], -0) ? "-0" : String(list[i])) : "hole");
  return "[" + parts.join() + "]";
}

function sum(t: Table): string {
  const r = t.row();
  let total = 0;
  for (let i = 0; i < r.length; i++) total += r[i];
  return String(total);
}

function grow(t: Table): string {
  const r = t.row();
  try {
    r.push(4);
    r[0] = 100;
  } catch (error) {
    return "threw " + (error instanceof Error ? error.constructor.name : typeof error) + " " + show(r);
  }
  return show(r);
}

function two(t: Table): string {
  const a = t.row();
  const b = t.row();
  try {
    a[1] = -5;
  } catch (error) {
    return "threw " + (error instanceof Error ? error.constructor.name : typeof error) + " " + show(a);
  }
  return (a === b) + " " + show(a) + " " + show(b);
}

function integers(t: Table): string {
  const r = t.row();
  return [r[0] | 0, r[1] + 1, r[2] * 2, r[0] / 2, r.length].map(n => (Object.is(n, -0) ? "-0" : String(n))).join(" ");
}

const replacements: [string, () => number[]][] = [
  ["fractions", () => [0.5, 1.5, 2.5]],
  ["holes", () => new Array<number>(3)],
  [
    "a hole in the middle",
    () => {
      const list = [1, 2, 3];
      delete list[1];
      return list;
    },
  ],
  ["minus zero and not a number", () => [-0, NaN, Infinity]],
  ["empty", () => []],
  ["one shared array", () => shared],
  [
    "a frozen array",
    () => {
      const list = [1, 2, 3];
      Object.freeze(list);
      return list;
    },
  ],
  ["a subclass that overrides push", () => Noisy.from([1, 2, 3])],
  ["large numbers", () => [2 ** 31, 2 ** 32, -(2 ** 31) - 1]],
];

function round(label: string, t: Table): void {
  console.log(label + ": " + sum(t) + " | " + grow(t) + " | " + two(t) + " | " + integers(t) + " | " + t.row().constructor.name);
}

const t = new Table();
const original = Table.prototype.row;
let warm = 0;
for (let i = 0; i < 2000; i++) warm += sum(t).length + grow(t).length + two(t).length + integers(t).length;
console.log("2000 honest: " + warm);
round("the method", t);
for (const [label, replacement] of replacements) {
  round("never installed: " + label, t);
}
console.log("the shared array at the end: " + show(shared));
round("put back", t);

export {};
