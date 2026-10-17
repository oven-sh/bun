// An object literal passed as `any` has no written type, so a later store through `any` may replace a number with a string, a string with a number, and so on.
const untyped = (x: any): any => x;
const o = untyped({ count: 1, label: "a", on: true, more: { n: 1 } });
o.count = "many";
o.label = 5;
o.on = null;
o.more = [1, 2];
console.log(o.count, o.label, o.on, o.more.length, JSON.stringify(o), Object.keys(o).join());
