// Required fields that are stored right after an object's allocation can never be observed as missing; frozen objects, reflection and untyped callers see the same as in plain Bun.
const show = (what: string, o: object) => console.log(what, JSON.stringify(Object.keys(o)), JSON.stringify(o))
enum Flags { None = 0, One = 1, All = -1 }
// Through `any`, by a computed name: no written type is involved in the read.
const read = (o: any, name: string) => o[name]
const list = [1]

interface A { o: number[]; x: number; y: Flags; z: number; w?: number }
function ACtor(this: A, o: number[], x: number, extra: boolean) { this.o = o; this.x = x; this.y = Flags.All; if (extra) this.w = 7; this.z = x + 1 }
const A = ACtor as unknown as new (o: number[], x: number, extra: boolean) => A
show("A", new A(list, 1, false)); show("A", new A(list, 2, true))
let sum = 0
for (let i = 0; i < 3; i++) { const a = new A(list, i, i == 1); sum += a.x + a.y + a.z + (a.w ?? 0) + a.o.length }
console.log("A sum", sum)

// Two functions for one type, in different orders: the keys follow the function that ran.
interface B { o: number[]; p: number; q: number; r: number }
function B1(this: B, o: number[], n: number, m: number) { this.p = n; this.q = m; this.r = 12; this.o = o }
function B2(this: B, o: number[], n: number, m: number) { this.o = o; this.p = n; this.r = 12; this.q = m }
const makers = [B1, B2, B1] as unknown as (new (o: number[], n: number, m: number) => B)[]
for (const Maker of makers) { const b = new Maker(list, 10, 11); show("B", b); console.log(b.p + b.q * 2 + b.r * 3 + b.o.length) }
const frozen = Object.freeze(new makers[0](list, 1, 2))
try { B2.call(frozen, list, 3, 4) } catch (e) { console.log("B frozen", (e as Error).constructor.name) }
show("B frozen", frozen)

// A default runs before the body and sees the object.
interface C { o: number[]; m: number; n: number }
const seen: string[] = []
function CCtor(this: C, m = (seen.push(JSON.stringify(Object.keys(this)), String("m" in this), String(read(this, "m"))), 5)) { this.o = list; this.m = m; this.n = 1 }
const C = CCtor as unknown as new (m?: number) => C
show("C", new C()); console.log(seen.join(" "))

// A value that contains a call may throw, and nothing references the object then.
interface D { o: number[]; u: number; v: number }
let fail = true
const next = () => { if (fail) throw new Error("no"); return 3 }
function DCtor(this: D, o: number[]) { this.u = next(); this.v = 4; this.o = o }
const D = DCtor as unknown as new (o: number[]) => D
try { new D(list) } catch (e) { console.log("D", (e as Error).message) }
fail = false; show("D", new D(list))

// `this` escapes after the second store.
interface E { o: number[]; a: number; b: number }
const peek = (e: E) => console.log("peek", JSON.stringify(Object.keys(e)), e.a, e.o.length, read(e, "b"), "b" in e, Object.hasOwn(e, "b"))
function ECtor(this: E, o: number[]) { this.o = o; this.a = 1; peek(this); this.b = 2 }
const E = ECtor as unknown as new (o: number[]) => E
show("E", new E(list))

// A type that admits untyped objects.
interface F { f: number; g: number }
function FCtor(this: F, f: number) { this.f = f; this.g = 2 }
const F = FCtor as unknown as new (f: number) => F
const parsed: F = JSON.parse('{"g":5,"f":6}')
for (const it of [new F(1), parsed]) { show("F", it); console.log(it.f + it.g * 2) }
FCtor.call(parsed, 7); show("F call", parsed)

// A setter under the name of a field takes the store.
interface G { o: number[]; v: number; t: number }
function GCtor(this: G, o: number[], v: number) { this.o = o; this.v = v; this.t = 1 }
let taken = 0
Object.defineProperty(GCtor.prototype, "v", { set(value: number) { taken = value }, get() { return -taken }, configurable: true })
const G = GCtor as unknown as new (o: number[], v: number) => G
const g = new G(list, 9); show("G", g); console.log(g.v, taken, Object.hasOwn(g, "v"))

// Every kind of caller: typed, untyped, `Reflect.construct`, and a call on an existing object.
interface H { o: number[]; k: Flags; n: number; s?: string }
function HCtor(this: H, o: number[], k: Flags, n: number) { this.k = k; this.n = n; this.o = o }
const H = HCtor as unknown as new (o: number[], k: Flags, n: number) => H
const h = new H(list, Flags.One, 2); h.s = "s"; show("H", h)
show("H any", new (HCtor as any)(list, Flags.All, 3))
show("H reflect", Reflect.construct(HCtor as any, [list, Flags.None, 4]))
HCtor.call(h, list, Flags.All, 5); show("H call", h)
const literal: H = { n: 6, o: list, k: Flags.One }; show("H literal", literal); HCtor.call(literal, list, Flags.None, 7); show("H literal", literal)
console.log(h.k & 3, h.n | 0, literal.k + literal.n, h.o.length)

// `this` of two types.
interface U1 { o: number[]; ua: number }
interface U2 { o: number[]; ua: number; ub: number }
function UCtor(this: U1 | U2, o: number[], ua: number) { this.ua = ua; this.o = o }
const U = UCtor as unknown as new (o: number[], ua: number) => U1
const u = new U(list, 3); show("U", u); console.log(u.ua + u.o.length)
const u2: U2 = { ub: 1, o: list, ua: 2 }; UCtor.call(u2, list, 4); show("U2", u2)

// A name that every object inherits.
interface T { o: number[]; tn: number; valueOf: () => number; tm: number }
function TCtor(this: T, o: number[], tn: number, valueOf: () => number) { this.o = o; this.tn = tn; this.valueOf = valueOf; this.tm = 1 }
const T = TCtor as unknown as new (o: number[], tn: number, valueOf: () => number) => T
const t = new T(list, 2, () => 40); show("T", t); console.log(+t + t.tn + t.tm, Object.hasOwn(t, "valueOf"))

// Two functions for one type, and the `prototype` of one escapes: nothing guards that of the other.
interface M { o: number[]; ma: number; mb: number }
function MCtor(this: M, o: number[], ma: number, mb: number) { this.o = o; this.ma = ma; this.mb = mb }
const escaped: any = MCtor.prototype; escaped.sum = function (this: M) { return this.ma + this.mb }
function MHalf(this: M, o: number[], ma: number) { this.o = o; this.ma = ma }
const M = MCtor as unknown as new (o: number[], ma: number, mb: number) => M
const Half = MHalf as unknown as new (o: number[], ma: number) => M
const m = new M(list, 1, 2); show("M", m); console.log((m as any).sum())
const half = new Half(list, 3); show("M half", half); console.log(read(half, "ma"), read(half, "mb"))
let kept = 0
Object.defineProperty(Object.getPrototypeOf(half), "ma", { set(value: number) { kept = value }, configurable: true })
const later = new Half(list, 5); show("M half, a setter", later); console.log(kept, read(later, "ma"), Object.hasOwn(later, "ma"))

// A callee that is not a constructor function of the type: it declares no `this`, so it does not receive the allocated object, whether
// or not the compiler knows the callee. Any function fits a constructor type, and what it creates is no `H` but an object, which passes an object type, so nothing is thrown: as in plain Bun.
const Other = function (this: any) { this.other = 1 } as unknown as new (o: number[], k: Flags, n: number) => H
try { const o = new Other(list, Flags.One, 1); console.log("Other", JSON.stringify(o), read(o, "k")) } catch (e) { console.log("Other", (e as Error).constructor.name) }
