// A literal with a spread in it, passed as `any`: its members are stored over, and the object that was spread is not changed.
interface Base { id: number; label: string }
const untyped = (x: any): any => x;
const base: Base = { id: 1, label: "a" };
const o = untyped({ ...base, more: { n: 1, extra: "e" } });
o.more = { n: 2 };
o.label = 5;
console.log(o.id, o.label, o.more.n, o.more.extra, JSON.stringify(o), base.label);
const p = untyped({ more: { n: 1, extra: "e" }, ...base });
p.more = "none";
p.id = "one";
console.log(p.id, p.label, p.more, JSON.stringify(p), base.id);
