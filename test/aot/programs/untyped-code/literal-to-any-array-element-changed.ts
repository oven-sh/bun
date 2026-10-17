// A literal passed to a function that is an element of an array of `any`.
function alter(target: any): any {
  target.more = { n: 2 };
  target.count = "many";
  return target;
}
const table: any[] = [alter];
const o = table[0]({ count: 1, more: { n: 1, extra: "e" } });
console.log(o.more.n, o.more.extra, o.count, JSON.stringify(o));
const list = table[0]([{ n: 1, extra: "e" }, { n: 2, extra: "f" }]);
list[0].extra = 5;
list[1] = { n: 3 };
console.log(JSON.stringify(list), list.more.n, list.count);
