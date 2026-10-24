// A literal passed as `unknown` and cast to a wider type.
function keep(x: unknown): unknown {
  return x;
}
const o = keep({ count: 1, more: { n: 1, extra: "e" } }) as { count: number | string; more: { n: number; extra?: string } };
o.more = { n: 2 };
o.count = "many";
console.log(o.more.n, o.more.extra, o.count, JSON.stringify(o));
