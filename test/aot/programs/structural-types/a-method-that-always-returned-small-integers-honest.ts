class Stock {
  items: string[] = ["a", "b", "c"];
  count(): number {
    return this.items.length;
  }
}

function show(n: number): string {
  return Object.is(n, -0) ? "-0" : String(n);
}

function uses(s: Stock): string {
  const n = s.count();
  return [show(n), show(s.count() + 1), show(s.count() * 2), show(s.count() | 0), show(s.count() >>> 0), show(1 / s.count()), show(s.count() % 2), show(-s.count()), String(s.items[s.count() - 1]), String(s.count() === 3), String(s.count() < 3), typeof n].join(" ");
}

function total(s: Stock, rounds: number): string {
  let sum = 0;
  for (let i = 0; i < rounds; i++) sum += s.count();
  return show(sum);
}

function fill(s: Stock): string {
  const list: number[] = [];
  for (let i = 0; i < 3; i++) list.push(s.count());
  return list.map(show).join() + " " + JSON.stringify(list);
}

const s = new Stock();
const original = Stock.prototype.count;

function round(label: string): void {
  console.log(label + ": " + uses(s) + " | " + total(s, 4) + " | " + fill(s));
}

let warm = 0;
for (let i = 0; i < 2000; i++) warm += uses(s).length + s.count();
console.log("2000 honest: " + warm);
round("the method");

const replacements: [string, () => number][] = [
  ["a fraction", () => 2.5],
  ["minus zero", () => -0],
  ["not a number", () => NaN],
  ["two to the 31st", () => 2 ** 31],
  ["two to the 53rd", () => 2 ** 53],
  ["a negative number", () => -7],
  ["infinity", () => Infinity],
  ["the largest small integer", () => 2147483647],
];

for (const [label, replacement] of replacements) {
  round("never installed: " + label);
}

round("put back");

export {};
