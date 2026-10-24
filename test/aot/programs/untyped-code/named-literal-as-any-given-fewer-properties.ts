// An object literal that has a name first and is then passed as `any`: a store through `any` may replace a member with an object that has fewer properties, and typed code that still holds the literal reads what is there.
const untyped = (x: any): any => x;
const written = { value: { key: 1 }, more: { n: 1, extra: "e" } };
const o = untyped(written);
o.more = { n: 2 };
console.log(o.more.n, o.more.extra, written.more.n, written.more.extra, JSON.stringify(written), o === written);
o.value = "none";
console.log(o.value, String(written.value), Object.keys(written).join());
