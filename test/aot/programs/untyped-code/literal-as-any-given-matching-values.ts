// Stores that match what the literal started with.
const untyped = (x: any): any => x;
let sum = 0;
for (let i = 0; i < 1000; i++) {
  const o = untyped({ count: i, more: { n: i, extra: "e" } });
  o.count = i + 1;
  o.more = { n: i + 2, extra: "f" };
  sum += o.count + o.more.n + o.more.extra.length;
}
console.log(sum);
