interface Top {
  held: unknown;
  count?: number;
  list: number[];
}
interface Two {
  first?: unknown;
  second?: unknown;
  third?: unknown;
}
function top(held: unknown, count?: number): Top {
  return { held, count, list: [] };
}
function two(first?: unknown, second?: unknown, third?: unknown): Two {
  return { first, second, third };
}
const held: unknown[] = [
  { text: "plain" },
  { text: "\u00e9" },
  { text: "\u4e2d" },
  { text: "\ud83d\ude00" },
  { text: "\ud800" },
  ["\u4e2d"],
  [{ text: "\u4e2d" }],
  { "\u4e2d": 1 },
  { inner: { text: "\u4e2d" }, after: 1 },
  "\u4e2d",
  {},
  [],
];
for (const value of held) {
  console.log(JSON.stringify(top(value, 127)));
  console.log(JSON.stringify(top(value)));
  console.log(JSON.stringify([top(value, 1), top(value)]));
  console.log(JSON.stringify(two(value, value, value)));
  console.log(JSON.stringify(two(undefined, value, value)));
  console.log(JSON.stringify(two(value, undefined, value)));
  console.log(JSON.stringify(two(undefined, undefined, value)));
  console.log(JSON.stringify(two(top(value), top(value, 2))));
  console.log(JSON.stringify(top(value, 127), null, 2));
  console.log(JSON.parse(JSON.stringify(top(value, 127))).count);
}
