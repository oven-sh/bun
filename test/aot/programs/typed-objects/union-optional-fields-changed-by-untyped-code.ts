// Objects of a union of record types with optional fields are changed by untyped code: fields added, deleted, redefined, frozen, inherited, parsed from JSON.
type A = { kind: "a"; x?: string; y?: string; z?: number };
type B = { kind: "b"; p?: string; q?: string; r?: number };
type C = { kind: "c"; x?: string; p?: string; w?: string; v?: string; u?: string; t?: string; s?: string; o?: string; n?: string; m?: string };
type U = A | B | C;
const say = (what: string, got: unknown) => console.log(what + ": " + (typeof got === "string" ? got : JSON.stringify(got) ?? String(got)));
const mkA = (): A => ({ kind: "a" }); const mkAx = (): A => ({ kind: "a", x: "x" }); const mkB = (): B => ({ kind: "b", p: "p" });
const mkC = (): C => ({ kind: "c", x: "cx", p: "cp", w: "w", v: "v", u: "u", t: "t", s: "s", o: "o", n: "n", m: "m" });
function all(o: U): string {
  if (o.kind === "a") return "a " + o.x + " " + o.y + " " + o.z;
  if (o.kind === "b") return "b " + o.p + " " + o.q + " " + o.r;
  return "c " + o.x + " " + o.p + " " + o.w + " " + o.v + " " + o.u + " " + o.t + " " + o.s + " " + o.o + " " + o.n + " " + o.m;
}
const asA = (o: A): string => o.x + " " + o.y + " " + o.z; const asB = (o: B): string => o.p + " " + o.q + " " + o.r;
const set = (o: any, k: string, v: unknown) => { o[k] = v; }; const del = (o: any, k: string) => { delete o[k]; };
const through = <T,>(o: unknown): T => o as T;
const outside = <T,>(text: string): T => JSON.parse(text) as T;

say("born", [all(mkA()), all(mkAx()), all(mkB()), all(mkC())]);
{ const o = mkA(); const before = asA(o); set(o, "y", "later"); set(o, "x", "later still"); set(o, "z", 3); say("given what there was no room for", [before, asA(o), Object.keys(o).join()]); }
{ const o = mkAx(); del(o, "x"); const gone = asA(o); set(o, "x", "again"); say("taken out and put back", [gone, asA(o), o]); }
{ const o = mkAx(); del(o, "x"); set(o, "p", "a name of another type with the same slot, maybe"); say("another name where one was", [asA(o), asB(through<B>(o)), o]); }
{ const o = mkAx(); set(o, "p", "P"); set(o, "q", "Q"); say("names of both", [asA(o), asB(through<B>(o)), o]); }
{ const o = mkB(); say("seen as the other", [asA(through<A>(o)), asB(o)]); }
{ const o = mkAx(); let got = 0; try { Object.defineProperty(o, "x", { get() { got++; return "from a getter"; }, configurable: true, enumerable: true }); } catch (e) { say("an accessor is refused", (e as Error).constructor.name); } say("an accessor", [asA(o), got > 0]); }
{ const o = mkAx(); Object.freeze(o); let threw = "no"; try { o.x = "written"; } catch (e) { threw = (e as Error).constructor.name; } say("frozen", [asA(o), threw]); }
{ const o = mkAx(); Object.seal(o); o.x = "written"; let threw = "no"; try { o.y = "added"; } catch (e) { threw = (e as Error).constructor.name; } say("sealed", [asA(o), threw]); }
{ const o = mkAx(); Object.preventExtensions(o); o.x = "written"; say("not extensible", asA(o)); }
{ const o = mkA(); Object.setPrototypeOf(o, { x: "inherited x", y: "inherited y" }); say("inherits what it lacks", asA(o)); set(o, "x", "own"); say("and then has one", asA(o)); }
{ const o = mkA(); Object.setPrototypeOf(o, null); say("inherits from nothing", asA(o)); }
say("from outside", [all(outside<U>('{"kind":"a","x":"ox","z":1}')), all(outside<U>('{"z":2,"y":"oy","kind":"a"}')), all(outside<U>('{"more":1,"kind":"b","and":2,"r":3,"more2":4,"q":"oq","more3":5,"more4":6,"p":"op"}'))]);
say("wide, from outside", all(outside<U>('{"m":"M","n":"N","o":"O","s":"S","t":"T","u":"U","v":"V","w":"W","p":"P","x":"X","kind":"c"}')));
{ const o = outside<A>('{"kind":"a","x":"ox"}'); const first = asA(o); const second = asA(o); o.y = "typed store"; say("looked at twice, then written", [first, second, asA(o), o]); }
{ const o = outside<A>('{"kind":"a","0":"index","x":"ox"}'); say("with an element", [asA(o), o]); }
{ class K { kind = "a" as const; x?: string = "of a class"; get y() { return "a getter of the class"; } } say("an instance of a class", asA(new K())); }
{ const p = new Proxy<A>({ kind: "a", x: "target" }, { get: (t, k) => (k === "y" ? "trapped" : (t as any)[k]) }); say("a proxy", asA(p)); }
{ const o = Object.create({ kind: "a", x: "all inherited" }) as A; say("has nothing of its own", asA(o)); }
{ const o: any = { kind: "a" }; for (let i = 0; i < 200; i++) o["k" + i] = i; for (let i = 0; i < 200; i++) delete o["k" + i]; o.x = "of a dictionary"; say("a dictionary", [asA(o as A), Object.keys(o).join()]); del(o, "x"); say("and without", asA(o as A)); }
{ const o = mkAx(); const copy = { ...o }; const more: A = { ...o, y: "added in the copy" }; const assigned: A = Object.assign({ kind: "a" as const }, o); say("copies", [asA(copy), asA(more), asA(assigned), asA(structuredClone(o))]); }
{ const o: any = { kind: "a", x: "plain x" }; Object.defineProperty(o, "hidden", { value: 1, enumerable: false }); say("with one that is not enumerable", [asA(o as A), asA(o as A), Object.keys(o).join(), JSON.stringify(o), o.hidden]); }
{ const o: any = { kind: "a", z: 4 }; let got = 0; Object.defineProperty(o, "x", { get() { got++; return "got " + got; }, enumerable: true, configurable: true }); say("with a getter for a field", [asA(o as A), asA(o as A), got, Object.keys(o).join(), JSON.stringify(o)]); }
{ const o: any = { kind: "a", x: "plain x" }; let got = 0; Object.defineProperty(o, "other", { get() { got++; return "other"; }, set(_v: unknown) { got += 10; }, enumerable: true }); say("with a getter for something else", [asA(o as A), asA(o as A), o.other, got, (o.other = 1, got), JSON.stringify(o)]); }
{ const o: any = { kind: "a" }; Object.defineProperty(o, "x", { value: "read-only x", writable: false, enumerable: true, configurable: true }); let threw = "no"; const a = o as A; const first = asA(a); try { a.x = "written"; } catch (e) { threw = (e as Error).constructor.name; } say("with a field that is read-only", [first, asA(a), threw, Object.getOwnPropertyDescriptor(o, "x")]); }
{ const proto: any = { kind: "a", x: "of the prototype" }; const child = Object.create(proto); say("what is a prototype", [asA(proto as A), asA(child as A)]); proto.x = "changed"; proto.y = "added"; say("and is changed", [asA(proto as A), asA(child as A)]); }
{ const o: any = { get kind() { return "a"; }, x: "x", get y() { return "y of a getter"; } }; say("a literal with getters", [asA(o as A), asA(o as A), all(o as U), Object.keys(o).join()]); }
const thrice = (o: A): string => (o.x === "1" || o.x === "2" || o.x === "3" ? "yes " : "no ") + o.x + " " + o.x;
const both = (o: A): string => o.x + " " + o.y + " " + o.x + " " + o.y;
say("just read, before anything else has been", [thrice(mkAx()), thrice(mkA()), thrice(outside<A>('{"kind":"a","x":"2"}')), both(mkAx())]);
{ let n = 0; const o: any = { kind: "a" }; Object.defineProperty(o, "x", { get() { return String(++n); }, enumerable: true, configurable: true }); say("a getter is asked every time", [thrice(o as A), n, thrice(o as A), n]); }
{ let n = 0; const p = new Proxy<A>({ kind: "a" }, { get: (t, k) => (k === "x" ? String(++n) : (t as any)[k]) }); say("so is a proxy", [thrice(p), n]); }
{ let n = 0; class G { kind = "a" as const; get x() { return String(++n); } } say("and a getter of a class", [thrice(new G()), n]); }
{ let n = 0; const o = Object.create({ get x() { return String(++n); } }) as A; (o as any).kind = "a"; say("and one that is inherited", [thrice(o), n]); }
{ const o: any = { kind: "a", x: "before" }; Object.defineProperty(o, "y", { get() { o.x = "changed by the getter of y"; return "y"; }, enumerable: true, configurable: true }); say("a getter that writes another field", both(o as A)); }
say("just read, afterwards", [thrice(mkAx()), thrice(mkA()), thrice(outside<A>('{"kind":"a","x":"2"}')), both(mkAx())]);
for (const bad of [undefined, null]) { let what: string; try { what = asA(through<A>(bad)); } catch (e) { what = (e as Error).constructor.name; } say("of " + bad, what); }
{ const list: U[] = []; for (let i = 0; i < 12; i++) list.push(i % 4 === 0 ? mkA() : i % 4 === 1 ? mkAx() : i % 4 === 2 ? mkB() : outside<U>('{"kind":"b","q":"' + i + '"}'));
  let s = ""; for (let round = 0; round < 3; round++) { for (const o of list) s += all(o).length + ","; for (const o of list) if (o.kind === "a") { if (round === 0) o.y = "r0"; else del(o, "y"); } else if (o.kind === "b") set(o, round ? "p" : "r", round ? "R" : 7); }
  say("a mixture", s); say("in the end", list.map(all).join(";")); }
export {};
