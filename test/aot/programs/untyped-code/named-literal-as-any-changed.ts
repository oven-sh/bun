// A named literal that is looked at as `any`: through `as any`, and through a variable annotated `any`.
const first = { count: 1, more: { n: 1, extra: "e" } };
(first as any).more = { n: 10 };
(first as any).count = "many";
console.log(first.more.n, first.more.extra, String(first.count), JSON.stringify(first));
const second = { total: 2, rest: { m: 2, other: "f" } };
const loose: any = second;
loose.rest = { m: 20 };
loose.total = "many";
console.log(second.rest.m, second.rest.other, String(second.total), JSON.stringify(second), loose === second);
