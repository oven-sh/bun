// A literal written as a member of type `unknown` of a typed literal has no written type, so a later store through `any` may replace its members with other kinds of values.
interface Base { flags: number; node: unknown }
const b: Base = { flags: 1, node: { count: 1, more: { n: 1, extra: "e" } } };
const loose = b.node as any;
loose.more = { n: 2 };
loose.count = "many";
console.log(loose.more.n, loose.more.extra, loose.count, JSON.stringify(b));
delete loose.count;
console.log("count" in loose, JSON.stringify(b), Object.keys(loose).join());
