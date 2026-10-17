// A literal returned from a function whose return type is `any`.
function make(): any {
  return { count: 1, more: { n: 1, extra: "e" } };
}
const o = make();
o.more = { n: 2 };
o.count = "many";
console.log(o.more.n, o.more.extra, o.count, JSON.stringify(o));
