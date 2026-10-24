interface Reading {
  value: number;
  count: number;
}

function text(n: number): string {
  return Object.is(n, -0) ? "-0" : String(n);
}

function value(r: Reading): number {
  return r.value;
}

function twice(r: Reading): number {
  return r.value * 2 + r.count;
}

function truncated(r: Reading): number {
  return (r.value | 0) + (r.count | 0);
}

function increment(r: Reading): number {
  r.count++;
  r.value += 1;
  return r.count;
}

const numbers = [
  0,
  -0,
  1,
  -1,
  0.5,
  NaN,
  Infinity,
  -Infinity,
  2147483647,
  2147483648,
  -2147483648,
  -2147483649,
  4294967295,
  9007199254740991,
  9007199254740992,
  1e308,
  5e-324,
];

function layouts(n: number): [string, Reading][] {
  const wide = { label: "wide", count: n, other: 0.25, value: n };
  return [
    ["value first", { value: n, count: n }],
    ["count first", { count: n, value: n }],
    ["wide", wide],
    ["cloned", structuredClone({ count: n, value: n })],
    ["assigned", Object.assign({}, { value: n }, { count: n })],
  ];
}

for (const n of numbers) {
  for (const [name, r] of layouts(n)) {
    const line = [text(value(r)), text(twice(r)), text(truncated(r)), text(increment(r)), text(r.value), text(r.count)];
    console.log(text(n) + ", " + name + ": " + line.join(" "));
  }
}

const one: Reading = { value: 1, count: 1 };
const history: string[] = [];
for (const n of numbers) {
  one.value = n;
  one.count = n;
  history.push(text(one.value) + "/" + text(twice(one)));
}
console.log("one object takes them all: " + history.join(" "));

const grows: Reading = { count: 2147483646, value: 2147483646 };
for (let i = 0; i < 4; i++) console.log("past the 32-bit limit: " + increment(grows) + " " + grows.value);

const shrinks: Reading = { value: 0, count: 0 };
shrinks.value *= -1;
shrinks.count = shrinks.count % -1;
console.log("zero times minus one: " + text(shrinks.value) + " " + text(shrinks.count) + " " + JSON.stringify(shrinks));
console.log("one over it: " + text(1 / shrinks.value));

export {};
