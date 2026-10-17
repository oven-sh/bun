// An object literal passed as `any` has no written type, so a later store through `any` may replace a member with an object that has fewer properties.
const untyped = (x: any): any => x;
const o = untyped({ value: { key: 1 }, more: { n: 1, extra: "e" } });
o.more = { n: 2 };
console.log(o.more.n, o.more.extra, JSON.stringify(o), Object.keys(o).join());
