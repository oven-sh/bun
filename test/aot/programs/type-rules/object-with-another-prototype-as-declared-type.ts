// A value that satisfies its type is never rejected for how it is represented. An heir made by Object.create, an instance of a class of untyped code, plain data, a frozen heir and an object without a prototype pass as `this` and as a parameter, stay what they are, and typed code reads and stores through them as plain JavaScript does.
interface Small { weight: number; run(this: Small, x: number): number }
interface Large { weight: number; inner: { a: number }; list: number[]; run(this: Large, x: number): number; grow(this: Large): Large }
function makeSmall(weight: number): Small { return { weight, run(x: number): number { return x + this.weight; } }; }
function makeLarge(weight: number): Large {
  return { weight, inner: { a: weight }, list: [weight], run(x: number): number { return x + this.weight + this.inner.a + this.list.length; }, grow(): Large { this.weight += 1; this.inner.a += 10; this.list.push(0); return this; } };
}
function total(of: Large): number { return of.weight + of.inner.a + of.list.length; }
function rename(of: Large, weight: number): Large { of.weight = weight; return of; }
const smalls: Small[] = [makeSmall(1), makeSmall(2)];
const larges: Large[] = [makeLarge(1), makeLarge(2)];
let sum = 0;
for (const s of smalls) sum += s.run(1);
for (const l of larges) sum += l.run(1) + total(l);
console.log(sum);
const attempt = function (what: string, run: () => any): void { try { console.log(what + ":", run()); } catch (error: any) { console.log(what + ":", error.constructor.name); } };
const loose: any = { smalls, larges, total, rename };
attempt("an heir as this, flat type", function (): any { return Object.create(loose.smalls[0]).run(5); });
attempt("an heir as this", function (): any { return Object.create(loose.larges[0]).run(5); });
attempt("an heir as a parameter", function (): any { return loose.total(Object.create(loose.larges[1])); });
attempt("an heir of an heir", function (): any { return Object.create(Object.create(loose.larges[0])).run(5); });
attempt("this is the heir itself", function (): any { const heir = Object.create(loose.larges[0]); return heir.grow() === heir; });
attempt("a store through this lands on the heir", function (): any { const heir = Object.create(loose.larges[1]); heir.grow(); return [Object.keys(heir).join(), heir.weight, loose.larges[1].weight, loose.larges[1].inner.a, loose.larges[1].list.length].join(" "); });
attempt("a store through a parameter lands on the heir", function (): any { const heir = Object.create(loose.larges[1]); return [loose.rename(heir, 50) === heir, Object.keys(heir).join(), heir.weight, loose.larges[1].weight].join(" "); });
const Untyped: any = (function (): any { function Made(this: any, w: any): void { this.weight = w; this.inner = { a: w }; this.list = [w, w]; } Made.prototype.run = loose.larges[0].run; Made.prototype.grow = loose.larges[0].grow; Made.prototype.extra = function (this: any): any { return "extra " + this.weight; }; return Made; })();
attempt("an instance of a class of untyped code as this", function (): any { return new Untyped(3).run(5); });
attempt("the same as a parameter", function (): any { return loose.total(new Untyped(4)); });
attempt("it stays what it is", function (): any { const made = new Untyped(5); const back = loose.rename(made, 6); return [back === made, back instanceof Untyped, back.extra(), Object.getPrototypeOf(back) === Untyped.prototype].join(" "); });
attempt("plain data as this", function (): any { return ({ weight: 3, inner: { a: 1 }, list: [], run: loose.larges[0].run, grow: loose.larges[0].grow }).run(5); });
attempt("plain data as a parameter", function (): any { return loose.total({ weight: 3, inner: { a: 1 }, list: [1, 2, 3], run: loose.larges[0].run, grow: loose.larges[0].grow }); });
attempt("a frozen heir", function (): any { return Object.freeze(Object.create(loose.larges[0])).run(5); });
attempt("a null prototype", function (): any { const bare = Object.assign(Object.create(null), { weight: 1, inner: { a: 2 }, list: [], run: loose.larges[0].run, grow: loose.larges[0].grow }); return loose.total(bare); });
attempt("the typed objects still work", function (): any { return [larges[0]!.run(1), total(larges[1]!), smalls[0]!.run(1)].join(" "); });
