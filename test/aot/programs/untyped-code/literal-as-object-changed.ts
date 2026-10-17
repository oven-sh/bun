// A literal passed as `object` and stored to through `as any`.
function alter(target: object): void {
  (target as any).more = { n: 2 };
  (target as any).count = "many";
}
function keep(target: object): object {
  alter(target);
  return target;
}
const o = keep({ count: 1, more: { n: 1, extra: "e" } }) as any;
console.log(o.more.n, o.more.extra, o.count, JSON.stringify(o));
