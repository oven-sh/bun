// A literal passed as `this` through `call` and `apply` of a function of type `any`.
function alter(this: any, n: number): any {
  this.more = { n };
  this.count = "many";
  return this;
}
const f: any = { alter };
const made = [
  f.alter.call({ count: 1, more: { n: 1, extra: "e" } }, 2),
  f.alter.apply({ count: 1, more: { n: 1, extra: "e" } }, [3]),
];
for (const o of made) console.log(o.more.n, o.more.extra, o.count, JSON.stringify(o));
