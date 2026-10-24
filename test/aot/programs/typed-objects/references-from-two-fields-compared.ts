// `x.a === y.a` of two references that are read out of fields: one object or two, null, undefined, absent, a field that is never nil against one that may be, in a branch; and texts, which are compared by what they say.
function row(name: string, f: () => unknown): void { try { console.log(name + ": " + String(f())) } catch (e) { console.log(name + ": THROWS " + (e instanceof Error ? e.name + ": " + e.message.split("\n")[0].split(" (bun compile")[0] : String(e))) } }
function hide(v: unknown): any { return v }
interface N { v: number; w: number }
interface R { a: N; b: N | null; c: N | undefined; d?: N; s: string; t: string | null }
function n(i: number): N { return { v: i, w: i } }
function make(i: number): R { return { a: n(i), b: null, c: undefined, s: "s" + i, t: null } }
function same(x: R, y: R): boolean { return x.a === y.a }
function differ(x: R, y: R): boolean { return x.a !== y.a }
function sameB(x: R, y: R): boolean { return x.b === y.b }
function sameC(x: R, y: R): boolean { return x.c === y.c }
function sameD(x: R, y: R): boolean { return x.d === y.d }
function sameAB(x: R, y: R): boolean { return x.a === y.b }
function sameBC(x: R, y: R): boolean { return hide(x.b) === hide(y.c) }
function sameCD(x: R, y: R): boolean { return x.c === y.d }
function branch(x: R, y: R): number { if (x.a === y.a) return 1; if (x.b === y.b) return 2; return 3 }
function texts(x: R, y: R): boolean { return x.s === y.s }
function textsT(x: R, y: R): boolean { return x.t === y.t }
const F: { same: typeof same; differ: typeof differ; sameB: typeof sameB; sameC: typeof sameC; sameD: typeof sameD; sameAB: typeof sameAB; sameBC: typeof sameBC; sameCD: typeof sameCD; branch: typeof branch; texts: typeof texts; textsT: typeof textsT } = { same, differ, sameB, sameC, sameD, sameAB, sameBC, sameCD, branch, texts, textsT };
row("01 one object in two slots, two objects", () => { const x = make(1), y = make(2); const a = [F.same(x, y), F.differ(x, y)]; y.a = x.a; return a.concat([F.same(x, y), F.differ(x, y), F.same(x, x)]).join() });
row("02 null and null, null and an object, one object, two", () => { const x = make(1), y = make(2); const out = [F.sameB(x, y)]; x.b = n(1); out.push(F.sameB(x, y)); y.b = x.b; out.push(F.sameB(x, y)); y.b = n(1); out.push(F.sameB(x, y)); return out.join() });
row("03 undefined likewise", () => { const x = make(1), y = make(2); const out = [F.sameC(x, y)]; x.c = n(1); out.push(F.sameC(x, y)); y.c = x.c; out.push(F.sameC(x, y)); x.c = undefined; out.push(F.sameC(x, y)); return out.join() });
row("04 absent and absent, absent and undefined, absent and an object", () => { const x = make(1), y = make(2); const out = [F.sameD(x, y)]; y.d = undefined; out.push(F.sameD(x, y)); out.push(F.sameCD(x, y), F.sameCD(y, x)); y.d = n(1); out.push(F.sameD(x, y), F.sameCD(x, y)); x.d = y.d; out.push(F.sameD(x, y)); x.c = y.d; out.push(F.sameCD(x, y)); return out.join() });
row("05 a slot that is never nil and one that may be", () => { const x = make(1), y = make(2); const out = [F.sameAB(x, y)]; y.b = x.a; out.push(F.sameAB(x, y)); y.b = n(1); out.push(F.sameAB(x, y)); return out.join() });
row("06 null is not undefined", () => { const x = make(1), y = make(2); return F.sameBC(x, y) });
row("07 in a branch", () => { const x = make(1), y = make(2); const out = [F.branch(x, y)]; x.b = n(1); out.push(F.branch(x, y)); y.a = x.a; out.push(F.branch(x, y)); return out.join() });
row("08 texts are compared by what they say, not by where they lie", () => { const x = make(1), y = make(1); const out = [F.texts(x, y)]; y.s = "s" + hide(1); out.push(F.texts(x, y)); y.s = ["s", "1"].join(""); out.push(F.texts(x, y)); y.s = "s2"; out.push(F.texts(x, y)); out.push(F.textsT(x, y)); x.t = "a" + hide("b"); y.t = hide("a") + "b"; out.push(F.textsT(x, y)); y.t = null; out.push(F.textsT(x, y)); return out.join() });
