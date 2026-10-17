// A literal passed to a method of an object of type `any`, which stores over its members.
const table: any = {
  alter(target: any) {
    target.more = { n: 2 };
    target.count = "many";
    return target;
  },
};
const o = table.alter({ count: 1, more: { n: 1, extra: "e" } });
console.log(o.more.n, o.more.extra, o.count, JSON.stringify(o));
