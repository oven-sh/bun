// Named literals passed as `any` that nobody stores over: typed code goes on reading them.
const untyped = (x: any): any => x;
let sum = 0;
for (let i = 0; i < 1000; i++) {
  const written = { count: i, more: { n: i, extra: "e" } };
  const o = untyped(written);
  o.count = i + 1;
  o.more = { n: i + 2, extra: "f" };
  sum += written.count + written.more.n + written.more.extra.length + o.count;
}
console.log(sum);
