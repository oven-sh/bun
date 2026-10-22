// The other side of borrowed-prototype-unchanged.ts: an object that is the prototype of another object and does NOT satisfy the record type enters it like any object. A member of the wrong kind throws where typed code reads it, and a missing member reads undefined.
type Inner = { p: number; q?: string; deep: number[] };
type Outer = { inner: Inner; n?: number };
function own(): Outer { return { inner: { p: 7, deep: [1], q: "q" }, n: 2 }; }
const kept: unknown[] = [];
function enters(source: any): unknown { const o: Outer = source; return [o.inner.p, o.inner.q, o.n === undefined ? "none" : o.n + 1]; }
function attempt(name: string, f: () => unknown): void { try { console.log(name, JSON.stringify(f())); } catch (e) { console.log(name, (e as Error).name); } }
const built = (entries: [string, unknown][], onto: any = {}): any => { for (const [name, value] of entries) onto[name] = value; return onto; };
const heirOf = (made: any): any => { kept.push(Object.create(made)); return made; };
attempt("one of its own:", () => enters(own()));
attempt("one that matches:", () => enters(heirOf(built([["inner", built([["p", 1], ["deep", [1]]])]]))));
attempt("without the member:", () => enters(heirOf(built([["other", 1]]))));
attempt("a number under the name:", () => enters(heirOf(built([["inner", 5]]))));
attempt("a string under the optional name:", () => enters(heirOf(built([["inner", built([["p", 1], ["deep", [1]]])], ["n", "no"]]))));
attempt("below, without a member:", () => enters(built([["inner", heirOf(built([["deep", [1]]]))]])));
attempt("below, a string for the number:", () => enters(built([["inner", heirOf(built([["p", "no"], ["deep", [1]]]))]])));
