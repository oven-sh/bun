#!/usr/bin/env python3
"""undersized-record-accepts-untyped-objects.py <folder>: A record type with many optional members may be laid out without room for all of them, and then it admits objects that were made elsewhere (parsed data). Each line is as plain Bun's, or says "TypeError" where plain Bun has a value: never a third answer. a*, b*: whole programs. <program>__<n>: every line of the program that is no row, and one row, because types that rows share change what is laid out."""
import os, sys

os.makedirs(sys.argv[1], exist_ok=True)
os.chdir(sys.argv[1])
HEAD = r'''
function row(name: string, f: () => unknown) {
  try { const value = f(); console.log(name + ": " + (typeof value === "string" ? value : JSON.stringify(value))) }
  catch (e) { console.log(name + ": " + (e instanceof TypeError ? "TypeError" : "other " + e)) }
}
interface Meta { source: string; hops: number; a?: number; b?: number; c?: number; d?: number; e?: number; f?: number; g?: number }
interface Msg {
  id: number; at: number; size: number; weight: number; body: string
  meta?: Meta; retries?: number; delay?: number; whenSent?: number; score?: number; tags?: string[]
}
const line = '{"id":1,"at":0.5,"size":2.5,"weight":3.5,"body":"hello"}'
const full = '{"id":2,"at":0.5,"size":2.5,"weight":3.5,"body":"hi","meta":{"source":"wire","hops":2},"retries":1,"tags":["x","y"]}'
const bag: unknown[] = []
function travel(x: unknown): any { bag.push(x); return bag.pop() }
function own(n: number): Msg { return { id: n, at: 1.5, size: 2.5, weight: 3.5, body: "own", retries: n, delay: 0.5, whenSent: 4.5, score: 0.25, tags: ["o"], meta: { source: "own", hops: 1, a: 1, b: 2, c: 3, d: 4, e: 5, f: 6, g: 7 } } }
function sum(m: Msg): string { return m.id + "|" + m.at + "|" + m.size + "|" + m.weight + "|" + m.body + "|" + (m.retries ?? "-") + "|" + (m.delay ?? "-") + "|" + (m.whenSent ?? "-") + "|" + (m.score ?? "-") + "|" + (m.meta ? m.meta.source + m.meta.hops + (m.meta.a ?? "-") : "-") + "|" + (m.tags ? m.tags.join("") : "-") }
'''
P = {}
P['a01_a_union_told_apart_by_a_tag'] = r'''
type A = { kind: "a"; p: number; q: number; r: number; s: number; t: number; u: number; v?: number; w?: string }
type B = { kind: "b"; x: number }
type C = { kind: "c"; p: string; q: number; r: number; s: number; t: number; u: number; v?: string }
function tell(u: A | B | C): string { switch (u.kind) { case "a": return "a" + (u.p + u.q + u.r + u.s + u.t + u.u) + (u.v ?? "-") + (u.w ?? "-"); case "b": return "b" + u.x; case "c": return "c" + u.p + u.q + (u.v ?? "-") } }
const texts = ['{"kind":"a","p":1,"q":2,"r":3,"s":4,"t":5,"u":6}', '{"kind":"b","x":7}', '{"kind":"c","p":"s","q":2,"r":3,"s":4,"t":5,"u":6}', '{"kind":"a","p":1,"q":2,"r":3,"s":4,"t":5,"u":6,"v":7,"w":"w"}', '{"kind":"c","p":"s","q":2,"r":3,"s":4,"t":5,"u":6,"v":"v"}']
const made: (A | B | C)[] = [{ kind: "a", p: 1, q: 2, r: 3, s: 4, t: 5, u: 6, v: 8, w: "m" }, { kind: "b", x: 9 }, { kind: "c", p: "m", q: 2, r: 3, s: 4, t: 5, u: 6, v: "m" }]
for (const t of texts) row("stranger " + t.slice(9, 10), () => tell(travel(JSON.parse(t))))
for (const m of made) row("made " + m.kind, () => tell(m))
row("mixed, 300 rounds", () => { let s = 0; for (let i = 0; i < 300; ++i) { const u: A | B | C = i % 2 ? travel(JSON.parse(texts[i % 5])) : made[i % 3]; s += tell(u).length } return s })
row("a tag nobody has", () => tell(travel(JSON.parse('{"kind":"z","x":1}'))))
row("the tag of a, the members of b", () => tell(travel(JSON.parse('{"kind":"a","x":1}'))))
'''
P['a02_stored_to_a_field_of_a_closed_record'] = r'''
interface Box { m: Msg; n: number }
const box: Box = { m: own(1), n: 1 }
row("own", () => sum(box.m))
row("a stranger stored", () => { box.m = travel(JSON.parse(line)); return sum(box.m) })
row("read again", () => sum(box.m) + box.n)
row("another", () => { box.m = travel(JSON.parse(full)); return sum(box.m) })
row("own again", () => { box.m = own(2); return sum(box.m) })
row("in turn", () => { let s = ""; for (let i = 0; i < 300; ++i) { box.m = i % 3 ? travel(JSON.parse(i % 2 ? line : full)) : own(i); s = sum(box.m) + s.length } return s })
row("a box made with a stranger", () => { const b: Box = { m: travel(JSON.parse(line)), n: 2 }; return sum(b.m) + JSON.stringify(b) })
'''
P['a03_one_array_300_rounds'] = r'''
const all: Msg[] = []
for (let i = 0; i < 300; ++i) all.push(i % 2 ? own(i) : travel(JSON.parse(i % 4 ? line : full)))
row("ids", () => all.reduce((s, m) => s + m.id, 0))
row("retries", () => all.reduce((s, m) => s + (m.retries ?? 100), 0))
row("scores", () => all.reduce((s, m) => s + (m.score ?? 1), 0))
row("hops", () => all.reduce((s, m) => s + (m.meta?.hops ?? 10), 0))
row("tags", () => all.map(m => m.tags?.length ?? 9).join("").slice(0, 40))
row("sorted", () => all.slice().sort((a, b) => a.id - b.id || a.at - b.at).slice(0, 5).map(sum).join(";"))
row("found", () => sum(all.find(m => m.retries === 1)!))
row("filtered", () => all.filter(m => m.delay === undefined).length)
row("written", () => { for (const m of all) m.score = (m.score ?? 0) + 1; return all.reduce((s, m) => s + m.score!, 0) })
row("text of the first three", () => JSON.stringify(all.slice(0, 3)))
'''
P['a04_let_in_then_changed_by_untyped_code'] = r'''
function fresh(): { raw: any; m: Msg } { const raw = JSON.parse(full); const m: Msg = travel(raw); return { raw, m } }
row("as it came", () => sum(fresh().m))
row("a number becomes a string", () => { const { raw, m } = fresh(); sum(m); raw.id = "seven"; return sum(m) })
row("a number is read as a number", () => { const { raw, m } = fresh(); raw.id = "seven"; const n: number = m.id; return typeof n + n })
row("arithmetic on it", () => { const { raw, m } = fresh(); raw.at = "x"; return m.at * 2 })
row("a required member is deleted", () => { const { raw, m } = fresh(); delete raw.body; return sum(m) })
row("a string becomes a number", () => { const { raw, m } = fresh(); raw.body = 5; return m.body.length })
row("the array becomes a string", () => { const { raw, m } = fresh(); raw.tags = "xy"; return m.tags!.length + typeof m.tags })
row("the record below becomes a number", () => { const { raw, m } = fresh(); raw.meta = 7; return String(m.meta!.hops) })
row("the record below loses a member", () => { const { raw, m } = fresh(); delete raw.meta.hops; return String(m.meta!.hops) })
row("an optional becomes null", () => { const { raw, m } = fresh(); raw.retries = null; return String(m.retries ?? "nullish") })
row("a getter in place of a member", () => { const { raw, m } = fresh(); let n = 0; Object.defineProperty(raw, "id", { get() { return ++n } }); return m.id + "," + m.id })
row("a member more", () => { const { raw, m } = fresh(); raw.more = 1; return sum(m) + Object.keys(m).length })
row("many members more", () => { const { raw, m } = fresh(); for (let i = 0; i < 100; ++i) raw["k" + i] = i; return sum(m) + Object.keys(m).length })
row("another prototype", () => { const { raw, m } = fresh(); Object.setPrototypeOf(raw, { delay: 9 }); return sum(m) })
row("frozen, then written", () => { const { raw, m } = fresh(); Object.freeze(raw); m.retries = 5; return sum(m) })
row("changed in a loop that has read it 1000 times", () => { const { raw, m } = fresh(); let s = 0; for (let i = 0; i < 2000; ++i) { if (i === 1000) raw.id = "s"; s += (m.id as any) === "s" ? 1 : 0 } return s })
'''
P['a05_generic_containers'] = r'''
class Queue<T> { items: T[] = []; put(x: T) { this.items.push(x) } take(): T | undefined { return this.items.shift() } }
function same<T>(x: T): T { return x }
row("a Queue of Msg", () => { const q = new Queue<Msg>(); q.put(travel(JSON.parse(line))); q.put(own(1)); return sum(q.take()!) + sum(q.take()!) })
row("a Queue of unknown", () => { const q = new Queue<unknown>(); q.put(JSON.parse(line)); return sum(q.take() as Msg) })
row("a Map", () => { const m = new Map<string, Msg>(); m.set("a", travel(JSON.parse(line))); m.set("b", own(2)); return sum(m.get("a")!) + sum(m.get("b")!) })
row("a Set", () => { const s = new Set<Msg>(); const raw = JSON.parse(line); s.add(travel(raw)); return s.has(raw) + [...s].map(sum).join() })
row("through a generic function", () => sum(same<Msg>(travel(JSON.parse(full)))))
row("a tuple", () => { const t: [Msg, number] = [travel(JSON.parse(line)), 1]; return sum(t[0]) + t[1] })
row("a Record", () => { const r: Record<string, Msg> = {}; r.x = travel(JSON.parse(line)); r.y = own(3); return sum(r.x) + sum(r["y"]) })
row("an array of arrays", () => { const a: Msg[][] = [[travel(JSON.parse(line))], [own(4)]]; return a.flat().map(sum).join() })
row("a WeakMap by it", () => { const w = new WeakMap<Msg, number>(); const raw = JSON.parse(line); const m: Msg = travel(raw); w.set(m, 5); return w.get(raw) })
'''
P['a06_views_of_the_type'] = r'''
function partial(p: Partial<Msg>): string { return (p.id ?? "-") + "" + (p.retries ?? "-") + (p.body ?? "-") }
function ro(p: Readonly<Msg>): string { return p.id + p.body + (p.retries ?? "-") }
function pick(p: Pick<Msg, "id" | "retries" | "meta">): string { return p.id + "" + (p.retries ?? "-") + (p.meta?.source ?? "-") }
function omit(p: Omit<Msg, "body" | "tags">): string { return p.id + "" + p.at + (p.score ?? "-") }
function required(p: Required<Msg>): string { return p.id + "" + p.retries + p.delay + p.tags.length }
function both(p: Msg & { extra?: number }): string { return sum(p) + (p.extra ?? "-") }
for (const [name, text] of [["short", line], ["long", full]] as const) {
  row("Partial " + name, () => partial(travel(JSON.parse(text))))
  row("Readonly " + name, () => ro(travel(JSON.parse(text))))
  row("Pick " + name, () => pick(travel(JSON.parse(text))))
  row("Omit " + name, () => omit(travel(JSON.parse(text))))
  row("an intersection " + name, () => both(travel(JSON.parse(text))))
  row("as Msg, then each view " + name, () => { const m: Msg = travel(JSON.parse(text)); return partial(m) + ro(m) + pick(m) + omit(m) + both(m) })
}
row("Required, all there", () => required(travel(JSON.parse(JSON.stringify(own(1))))))
row("own in each view", () => { const m = own(5); return partial(m) + ro(m) + pick(m) + omit(m) + both(m) + required(m as Required<Msg>) })
row("Partial of nothing", () => partial(travel(JSON.parse("{}"))))
'''
P['a07_a_class_with_a_field_of_the_type'] = r'''
class Holder { m: Msg; last?: Msg; constructor(m: Msg) { this.m = m } get text(): string { return sum(this.m) } swap(n: Msg): Msg { const was = this.m; this.m = n; this.last = was; return was } }
row("made with a stranger", () => new Holder(travel(JSON.parse(line))).text)
row("made with its own", () => new Holder(own(1)).text)
row("swapped", () => { const h = new Holder(own(1)); const was = h.swap(travel(JSON.parse(full))); return sum(was) + h.text + sum(h.last!) })
row("300 holders", () => { let s = 0; for (let i = 0; i < 300; ++i) s += new Holder(i % 2 ? own(i) : travel(JSON.parse(line))).text.length; return s })
class Sub extends Holder { n = 1; override get text(): string { return "sub" + super.text + this.n } }
row("a subclass", () => new Sub(travel(JSON.parse(line))).text)
row("static", () => { class S { static m: Msg = travel(JSON.parse(line)) } return sum(S.m) })
'''
P['a08_members_more_than_the_type_has'] = r'''
const extra = '{"zeta":1,"id":1,"at":0.5,"alpha":[1],"size":2.5,"weight":3.5,"body":"hello","9":"nine","1":"one","omega":{"id":"x"}}'
row("read", () => sum(travel(JSON.parse(extra))))
row("keys", () => { const m: Msg = travel(JSON.parse(extra)); return Object.keys(m).join() })
row("text", () => { const m: Msg = travel(JSON.parse(extra)); return JSON.stringify(m) })
row("for in", () => { const m: Msg = travel(JSON.parse(extra)); let s = ""; for (const k in m) s += k; return s })
row("spread", () => { const m: Msg = travel(JSON.parse(extra)); const c = { ...m }; return JSON.stringify(c) })
row("spread into its own type", () => { const m: Msg = travel(JSON.parse(extra)); const c: Msg = { ...m, retries: 4 }; return JSON.stringify(c) + sum(c) })
row("entries", () => { const m: Msg = travel(JSON.parse(extra)); return Object.entries(m).length })
row("written, then text", () => { const m: Msg = travel(JSON.parse(extra)); m.retries = 1; m.id = 5; m.delay = 2; return JSON.stringify(m) })
row("assign to its own", () => { const o = own(1); Object.assign(o, travel(JSON.parse(extra))); return JSON.stringify(o) })
'''
P['a09_null_and_wrong_kinds'] = r'''
const t = (s: string) => () => sum(travel(JSON.parse(s)))
row("null where optional", t('{"id":1,"at":0.5,"size":2.5,"weight":3.5,"body":"b","retries":null}'))
row("null where required", t('{"id":null,"at":0.5,"size":2.5,"weight":3.5,"body":"b"}'))
row("a string where a number", t('{"id":"1","at":0.5,"size":2.5,"weight":3.5,"body":"b"}'))
row("a number where a string", t('{"id":1,"at":0.5,"size":2.5,"weight":3.5,"body":7}'))
row("a required one is missing", t('{"id":1,"at":0.5,"size":2.5,"weight":3.5}'))
row("an array where a record", t('{"id":1,"at":0.5,"size":2.5,"weight":3.5,"body":"b","meta":[]}'))
row("a record where an array", t('{"id":1,"at":0.5,"size":2.5,"weight":3.5,"body":"b","tags":{}}'))
row("numbers in the array of strings", t('{"id":1,"at":0.5,"size":2.5,"weight":3.5,"body":"b","tags":[1,2]}'))
row("the record below lacks a member", t('{"id":1,"at":0.5,"size":2.5,"weight":3.5,"body":"b","meta":{"source":"s"}}'))
row("an array", t('[1,2]')); row("null", t('null')); row("a number", t('5')); row("a string", t('"s"')); row("true", t('true')); row("empty", t('{}'))
row("whole numbers where fractions stood", t('{"id":1,"at":1,"size":2,"weight":3,"body":"b"}'))
row("fractions where whole numbers stood", t('{"id":1.5,"at":0.5,"size":2.5,"weight":3.5,"body":"b","retries":0.5}'))
row("large", t('{"id":1099511627776,"at":1e300,"size":-0,"weight":1e-300,"body":""}'))
'''
P['a10_written_through_the_type'] = r'''
function pair(): { raw: any; m: Msg } { const raw = JSON.parse(line); return { raw, m: travel(raw) } }
row("it is the same object", () => { const { raw, m } = pair(); return (m as unknown) === raw })
row("an optional is added", () => { const { raw, m } = pair(); m.retries = 5; return raw.retries + JSON.stringify(raw) })
row("all optionals are added", () => { const { raw, m } = pair(); m.tags = ["t"]; m.score = 1; m.whenSent = 2; m.delay = 3; m.retries = 4; m.meta = { source: "s", hops: 1 }; return JSON.stringify(raw) + sum(m) })
row("a required one is written", () => { const { raw, m } = pair(); m.id += 1; m.body += "!"; return raw.id + raw.body })
row("undefined is written", () => { const { raw, m } = pair(); m.retries = undefined; return JSON.stringify(Object.keys(raw)) + ("retries" in raw) })
row("deleted through the type", () => { const { raw, m } = pair(); m.retries = 1; delete m.retries; return ("retries" in raw) + sum(m) })
row("its own record below a stranger", () => { const { raw, m } = pair(); m.meta = own(1).meta; return raw.meta.g + sum(m) })
row("a stranger below its own record", () => { const o = own(1); const below = JSON.parse('{"source":"w","hops":3}'); o.meta = travel(below); below.hops = 4; return sum(o) })
row("written by untyped code, read by the type", () => { const { raw, m } = pair(); raw.score = 0.75; return sum(m) })
row("300 writes in turn", () => { const { raw, m } = pair(); const o = own(1); let s = 0; for (let i = 0; i < 300; ++i) { const w = i % 2 ? m : o; w.score = i; w.retries = (w.retries ?? 0) + 1; s += w.score + w.retries } return s + "," + raw.score + "," + raw.retries })
'''
P['a11_not_plain_data'] = r'''
const base = () => JSON.parse(line)
row("members inherited", () => sum(travel(Object.create(base()))))
row("no prototype", () => sum(travel(Object.assign(Object.create(null), base()))))
row("getters", () => { let n = 0; const o = {}; for (const [k, v] of Object.entries(base())) Object.defineProperty(o, k, { get() { ++n; return v }, enumerable: true }); return sum(travel(o)) + n })
row("a Proxy", () => { let n = 0; return sum(travel(new Proxy(base(), { get(t, k, r) { ++n; return Reflect.get(t, k, r) } }))) + (n > 0) })
class Like { id = 1; at = 0.5; size = 2.5; weight = 3.5; body = "class"; retries?: number }
row("an object of a class", () => sum(travel(new Like())))
row("an array with the members", () => sum(travel(Object.assign([], base()))))
row("a function with the members", () => sum(travel(Object.assign(function () { }, base()))))
row("a literal of untyped code", () => sum(travel({ id: 1, at: 0.5, size: 2.5, weight: 3.5, body: "lit" } as any)))
row("built piece by piece", () => { const o: any = {}; o.body = "p"; o.weight = 3.5; o.size = 2.5; o.at = 0.5; o.id = 1; return sum(travel(o)) })
row("built piece by piece, 30 members", () => { const o: any = {}; for (let i = 0; i < 30; ++i) o["k" + i] = i; Object.assign(o, base()); return sum(travel(o)) })
row("sealed", () => sum(travel(Object.seal(base()))))
row("frozen", () => sum(travel(Object.freeze(base()))))
row("a clone", () => sum(travel(structuredClone(base()))))
row("its own, through text", () => sum(travel(JSON.parse(JSON.stringify(own(3))))))
row("its own, untyped and back", () => sum(travel(own(4))))
'''
P['a12_narrowing_and_destructuring'] = r'''
function isMsg(x: unknown): x is Msg { return typeof x === "object" && x !== null && typeof (x as any).id === "number" && typeof (x as any).body === "string" }
row("a guard", () => { const x: unknown = travel(JSON.parse(line)); return isMsg(x) ? sum(x) : "no" })
row("in", () => { const m: Msg = travel(JSON.parse(line)); return ("retries" in m) + "" + ("id" in m) + ("toString" in m) })
row("hasOwn", () => { const m: Msg = travel(JSON.parse(full)); return Object.hasOwn(m, "retries") + "" + Object.hasOwn(m, "delay") })
row("destructured", () => { const { id, retries = 7, delay = 8, meta: { hops, a = 9 } = { source: "", hops: 0 }, tags: [first = "none"] = [] }: Msg = travel(JSON.parse(line)); return [id, retries, delay, hops, a, first].join() })
row("destructured, long", () => { const { id, retries = 7, delay = 8, meta: { hops, a = 9 } = { source: "", hops: 0 }, tags: [first = "none"] = [] }: Msg = travel(JSON.parse(full)); return [id, retries, delay, hops, a, first].join() })
row("the rest", () => { const { id, body, ...rest }: Msg = travel(JSON.parse(full)); return id + body + JSON.stringify(rest) })
row("a parameter destructured", () => (({ id, score = 3 }: Msg) => id + score)(travel(JSON.parse(line))))
row("by a name computed", () => { const m: Msg = travel(JSON.parse(full)); const k: keyof Msg = (["id", "retries", "delay"] as const)[m.id % 3]; return String(m[k]) })
row("every name computed", () => { const m: Msg = travel(JSON.parse(full)); return (["id", "at", "size", "weight", "body", "retries", "delay", "whenSent", "score"] as const).map(k => String(m[k])).join() })
row("optional calls below", () => { const m: Msg = travel(JSON.parse(line)); return String(m.tags?.map(t => t + t).join()) + String(m.meta?.source.length) })
'''
P['a13_at_the_edge_of_the_filter'] = r'''
interface Six { a: number; b: number; c: number; d: number; e?: number; f?: number }
interface Seven { a: number; b: number; c: number; d: number; e: number; f: number; g: number }
interface SevenOne { a: number; b: number; c: number; d: number; e: number; f: number; g?: number }
interface SevenUndefined { a: number; b: number; c: number; d: number; e: number; f: number; g: number | undefined }
interface Twenty { a: number; b?: number; c?: number; d?: number; e?: number; f?: number; g?: number; h?: number; i?: number; j?: number; k?: number; l?: number; m?: number; n?: number; o?: number; p?: number; q?: number; r?: number; s?: number; t?: number }
const six = (x: Six) => x.a + x.b + x.c + x.d + (x.e ?? 10) + (x.f ?? 20)
const seven = (x: Seven) => x.a + x.b + x.c + x.d + x.e + x.f + x.g
const sevenOne = (x: SevenOne) => x.a + x.b + x.c + x.d + x.e + x.f + (x.g ?? 70)
const sevenU = (x: SevenUndefined) => x.a + x.b + x.c + x.d + x.e + x.f + (x.g ?? 70)
const twenty = (x: Twenty) => x.a + (x.b ?? 0) + (x.j ?? 0) + (x.t ?? 100)
const keep: unknown[] = [{ a: 1, b: 2, c: 3, d: 4, e: 5, f: 6 } satisfies Six, { a: 1, b: 2, c: 3, d: 4, e: 5, f: 6, g: 7 } satisfies Seven, { a: 1, b: 2, c: 3, d: 4, e: 5, f: 6, g: 7 } satisfies SevenOne, { a: 1, b: 1, c: 1, d: 1, e: 1, f: 1, g: 1, h: 1, i: 1, j: 1, k: 1, l: 1, m: 1, n: 1, o: 1, p: 1, q: 1, r: 1, s: 1, t: 1 } satisfies Twenty]
row("six, four there", () => six(travel(JSON.parse('{"a":1,"b":2,"c":3,"d":4}'))))
row("six, all there", () => six(travel(JSON.parse('{"a":1,"b":2,"c":3,"d":4,"e":5,"f":6}'))))
row("seven, all required", () => seven(travel(JSON.parse('{"a":1,"b":2,"c":3,"d":4,"e":5,"f":6,"g":7}'))))
row("seven, one optional, absent", () => sevenOne(travel(JSON.parse('{"a":1,"b":2,"c":3,"d":4,"e":5,"f":6}'))))
row("seven, one optional, there", () => sevenOne(travel(JSON.parse('{"a":1,"b":2,"c":3,"d":4,"e":5,"f":6,"g":7}'))))
row("seven, one may be undefined, absent", () => sevenU(travel(JSON.parse('{"a":1,"b":2,"c":3,"d":4,"e":5,"f":6}'))))
row("twenty, one there", () => twenty(travel(JSON.parse('{"a":1}'))))
row("twenty, the last there", () => twenty(travel(JSON.parse('{"a":1,"t":2}'))))
row("twenty, written", () => { const raw = JSON.parse('{"a":1}'); const x: Twenty = travel(raw); x.t = 5; x.j = 6; return twenty(x) + JSON.stringify(raw) })
row("kept", () => keep.length)
'''
P['a14_two_types_of_one_form'] = r'''
interface Twin { id: number; at: number; size: number; weight: number; body: string; meta?: Meta; retries?: number; delay?: number; whenSent?: number; score?: number; tags?: string[] }
interface Wider extends Msg { more?: number; evenMore?: string }
interface Narrow { id: number; body: string }
const twin = (t: Twin) => t.id + t.body + (t.retries ?? "-")
const wider = (w: Wider) => sum(w) + (w.more ?? "-")
const narrow = (n: Narrow) => n.id + n.body
row("as one, then the other", () => { const m: Msg = travel(JSON.parse(line)); const t: Twin = m; return sum(m) + twin(t) })
row("as the wider", () => wider(travel(JSON.parse(line))))
row("as Msg, then narrower", () => { const m: Msg = travel(JSON.parse(full)); return narrow(m) })
row("as narrower, untyped, as Msg", () => { const n: Narrow = travel(JSON.parse(full)); return narrow(n) + sum(travel(n)) })
row("own as each", () => { const o = own(1); return twin(o) + wider(o) + narrow(o) })
row("a wider literal as Msg", () => { const w: Wider = { ...own(2), more: 1, evenMore: "e" }; const m: Msg = w; return sum(m) + JSON.stringify(Object.keys(m).length) })
'''
P['a15_later'] = r'''
const done: string[] = []
const bus = new Map<string, ((m: Msg) => void)[]>()
function on(name: string, f: (m: Msg) => void) { (bus.get(name) ?? bus.set(name, []).get(name)!).push(f) }
function emit(name: string, data: unknown) { for (const f of bus.get(name) ?? []) (f as (x: any) => void)(data) }
on("m", m => { done.push("bus " + sum(m)) })
emit("m", JSON.parse(line)); emit("m", own(1)); emit("m", JSON.parse(full))
const p: Promise<any> = Promise.resolve(JSON.parse(line))
async function typed(): Promise<string> { const m: Msg = await p; return sum(m) }
async function* stream(): AsyncGenerator<unknown> { yield JSON.parse(line); yield own(2); yield JSON.parse(full) }
function* plainly(): Generator<any> { yield JSON.parse(line); yield own(3) }
done.push("awaited " + await typed())
for await (const x of stream()) done.push("streamed " + sum(x as Msg))
for (const x of plainly()) { const m: Msg = x; done.push("yielded " + sum(m)) }
await new Promise<void>(r => { const late: any = JSON.parse(line); setTimeout(() => { const x: Msg = late; done.push("timer " + sum(x)); r() }, 0) })
done.push("then " + await p.then((m: Msg) => sum(m)))
for (const d of done) console.log(d)
'''
P['a16_recursive'] = r'''
interface Tree { name: string; n: number; a?: number; b?: number; c?: number; d?: number; e?: number; kids?: Tree[]; next?: Tree }
const text = '{"name":"r","n":1,"kids":[{"name":"k1","n":2,"kids":[{"name":"g","n":3,"a":1}]},{"name":"k2","n":4,"next":{"name":"x","n":5}}]}'
function total(t: Tree): number { return t.n + (t.a ?? 0) + (t.kids ? t.kids.reduce((s, k) => s + total(k), 0) : 0) + (t.next ? total(t.next) : 0) }
function names(t: Tree): string { return t.name + (t.kids?.map(names).join("") ?? "") + (t.next ? names(t.next) : "") }
const mine: Tree = { name: "m", n: 10, a: 1, b: 2, c: 3, d: 4, e: 5, kids: [{ name: "mk", n: 20 }], next: { name: "mn", n: 30 } }
row("a stranger", () => total(travel(JSON.parse(text))) + names(travel(JSON.parse(text))))
row("its own", () => total(mine) + names(mine))
row("a stranger under its own", () => { mine.kids!.push(travel(JSON.parse(text))); return total(mine) + names(mine) })
row("its own under a stranger", () => { const s: Tree = travel(JSON.parse(text)); s.kids!.push(mine); s.next = { name: "o", n: 100 }; return total(s) + names(s) })
row("deep", () => { let t = '{"name":"l","n":1}'; for (let i = 0; i < 200; ++i) t = '{"name":"d","n":1,"next":' + t + '}'; return total(travel(JSON.parse(t))) })
'''

P['b01_into_a_typed_array'] = r'''
const t = () => travel(JSON.parse(line))
row("push", () => { const a: Msg[] = []; a.push(t()); return sum(a[0]) })
row("push of either", () => { const a: Msg[] = []; for (let i = 0; i < 4; ++i) a.push(i % 2 ? own(i) : t()); return a.map(sum).join(";") })
row("an element stored", () => { const a: Msg[] = []; a[0] = t(); return sum(a[0]) })
row("unshift", () => { const a: Msg[] = [own(1)]; a.unshift(t()); return sum(a[0]) })
row("a literal", () => { const a: Msg[] = [t(), own(1)]; return a.map(sum).join(";") })
row("concat", () => { const a: Msg[] = ([] as Msg[]).concat([t()]); return sum(a[0]) })
row("splice", () => { const a: Msg[] = [own(1)]; a.splice(0, 1, t()); return sum(a[0]) })
row("fill", () => { const a: Msg[] = new Array<Msg>(2).fill(t()); return sum(a[1]) })
row("Array.from", () => { const a: Msg[] = Array.from({ length: 2 }, () => t()); return sum(a[1]) })
row("map", () => { const a: Msg[] = [1, 2].map(() => t()); return sum(a[1]) })
row("reduce over it", () => { const a: Msg[] = []; a.push(t()); a.push(own(2)); return a.reduce((s, m) => s + m.id, 0) })
row("for of over it", () => { const a: Msg[] = []; a.push(t()); a.push(own(2)); let s = 0; for (const m of a) s += m.id + (m.retries ?? 10); return s })
row("by index over it", () => { const a: Msg[] = []; a.push(t()); a.push(own(2)); let s = 0; for (let i = 0; i < a.length; ++i) s += a[i].id + (a[i].retries ?? 10); return s })
'''
P['b02_a_whole_array_is_parsed'] = r'''
const text = "[" + line + "," + full + "," + line + "]"
row("as Msg[]", () => { const a: Msg[] = travel(JSON.parse(text)); return a.map(sum).join(";") })
row("its own pushed to it", () => { const a: Msg[] = travel(JSON.parse(text)); a.push(own(1)); return a.map(sum).join(";") })
row("the raw array sees it", () => { const raw = JSON.parse(text); const a: Msg[] = travel(raw); a.push(own(1)); a[0].retries = 9; return raw.length + "," + raw[0].retries + "," + raw[3].body })
interface Batch { items: Msg[]; n: number; first?: Msg }
row("in a small record", () => { const b: Batch = travel(JSON.parse('{"items":' + text + ',"n":3}')); return b.n + b.items.map(sum).join(";") + (b.first ? "f" : "-") })
type Env<T> = { data: T; n: number }
row("in a generic record", () => { const e: Env<Msg> = travel(JSON.parse('{"data":' + line + ',"n":3}')); return e.n + sum(e.data) })
row("in a generic record of arrays", () => { const e: Env<Msg[]> = travel(JSON.parse('{"data":' + text + ',"n":3}')); return e.n + e.data.map(sum).join(";") })
row("a Record of them", () => { const r: Record<string, Msg> = travel(JSON.parse('{"a":' + line + ',"b":' + full + '}')); return Object.keys(r).map(k => sum(r[k])).join(";") })
row("with a reviver", () => { const a: Msg[] = travel(JSON.parse(text, (k, v) => k === "id" ? v + 10 : v)); return a.map(sum).join(";") })
'''
P['b03_unions_without_a_tag'] = r'''
interface Narrow { id: number; body: string }
function u1(x: Msg | string | null): string { return x === null ? "null" : typeof x === "string" ? "s" + x : sum(x) }
function u2(x: Msg | Msg[]): string { return Array.isArray(x) ? x.map(sum).join(";") : sum(x) }
function u3(x: Msg | number[]): string { return Array.isArray(x) ? "n" + x.length : sum(x) }
function u4(x: Msg | undefined): string { return x ? sum(x) : "undefined" }
function u5(x: Msg | { error: string }): string { return "error" in x ? "e" + x.error : sum(x) }
for (const text of [line, full]) {
  row("or a string or null", () => u1(travel(JSON.parse(text)))); row("or an array of it", () => u2(travel(JSON.parse(text)))); row("or numbers", () => u3(travel(JSON.parse(text))))
  row("or undefined", () => u4(travel(JSON.parse(text)))); row("or an error", () => u5(travel(JSON.parse(text))))
}
row("the string", () => u1(travel(JSON.parse('"x"')))); row("the null", () => u1(travel(JSON.parse("null")))); row("the array", () => u2(travel(JSON.parse("[" + line + "]"))))
row("the numbers", () => u3(travel(JSON.parse("[1,2]")))); row("the undefined", () => u4(travel(undefined))); row("the error", () => u5(travel(JSON.parse('{"error":"bad"}'))))
row("own in each", () => u1(own(1)) + u2(own(1)) + u2([own(1)]) + u3(own(1)) + u4(own(1)) + u5(own(1)))
'''
P['b04_compound_writes'] = r'''
function pair(): { raw: any; m: Msg } { const raw = JSON.parse(line); return { raw, m: travel(raw) } }
row("??=", () => { const { raw, m } = pair(); m.retries ??= 4; m.retries ??= 5; return raw.retries })
row("+= on an absent one", () => { const { raw, m } = pair(); m.score! += 1; return String(raw.score) })
row("++", () => { const { raw, m } = pair(); ++m.id; m.id++; return raw.id })
row("||= and &&=", () => { const { raw, m } = pair(); m.delay ||= 3; m.delay &&= 4; return raw.delay })
row("push below", () => { const { raw, m } = pair(); (m.tags ??= []).push("a"); m.tags.push("b"); return raw.tags.join() })
row("written below", () => { const raw = JSON.parse(full); const m: Msg = travel(raw); m.meta!.hops += 1; m.meta!.g = 7; return JSON.stringify(raw.meta) })
row("swap of two", () => { const a = pair(), b = { raw: null, m: own(1) }; [a.m.id, b.m.id] = [b.m.id, a.m.id]; return a.raw.id + "," + b.m.id })
row("Object.assign through the type", () => { const { raw, m } = pair(); Object.assign(m, { retries: 2, score: 3 } satisfies Partial<Msg>); return JSON.stringify(raw) })
row("defineProperty through the type", () => { const { raw, m } = pair(); Object.defineProperty(m, "retries", { value: 6, enumerable: false, writable: true, configurable: true }); return m.retries + JSON.stringify(raw) })
'''
P['b05_who_is_who'] = r'''
const raw1 = JSON.parse(line), raw2 = JSON.parse(line)
const m1: Msg = travel(raw1), m2: Msg = travel(raw2), again: Msg = travel(raw1), o = own(1)
const list: Msg[] = [m1, o, m2]
row("===", () => [m1 === again, m1 === m2, (m1 as unknown) === raw1, Object.is(m1, raw1), m1 == again].join())
row("indexOf", () => [list.indexOf(m2), list.indexOf(again), list.indexOf(o), list.indexOf(travel(raw2)), list.includes(travel(raw1)), list.lastIndexOf(m1)].join())
row("a Map by it", () => { const k = new Map<Msg, string>([[m1, "one"], [o, "own"]]); return [k.get(again), k.get(travel(raw1)), k.get(m2), k.get(o), k.size].join() })
row("a Set of them", () => new Set<Msg>([m1, again, m2, o, travel(raw1), travel(o)]).size)
row("typeof and such", () => [typeof m1, m1 instanceof Object, Object.getPrototypeOf(m1) === Object.prototype, m1.constructor === Object, Array.isArray(m1), String(m1), Object.prototype.toString.call(m1)].join())
row("own, typeof and such", () => [typeof o, o instanceof Object, Object.getPrototypeOf(o) === Object.prototype, o.constructor === Object, String(o)].join())
'''
P['b06_every_kind_of_place'] = r'''
const t = () => travel(JSON.parse(line))
class K { kept: Msg | null = null; static count = 0; take(m: Msg): string { this.kept = m; return sum(m) } set it(m: Msg) { this.kept = m } get it(): Msg { return this.kept! } many(...ms: Msg[]): string { return ms.map(sum).join(";") } }
row("a method", () => new K().take(t()))
row("a setter and a getter", () => { const k = new K(); k.it = t(); return sum(k.it) })
row("a rest parameter", () => new K().many(t(), own(1), t()))
row("spread into it", () => new K().many(...[t(), own(1)]))
row("a default value", () => ((m: Msg = t()) => sum(m))())
row("a result", () => { function f(): Msg { return t() } return sum(f()) })
row("an arrow's result", () => sum(((): Msg => t())()))
row("let, written twice", () => { let m: Msg = own(1); m = t(); const a = sum(m); m = own(2); return a + sum(m) })
row("as", () => sum(t() as Msg)); row("as unknown as", () => sum(t() as unknown as Msg)); row("satisfies behind as", () => sum((t() as Msg) satisfies Msg))
row("asserts", () => { function must(x: unknown): asserts x is Msg { if (typeof x !== "object") throw new Error("no") } const x: unknown = t(); must(x); return sum(x) })
row("a conditional", () => { const m: Msg = Date.now() > 0 ? t() : own(1); return sum(m) })
const none: (Msg | null)[] = [null]
row("??", () => { const m: Msg = none[0] ?? t(); return sum(m) })
row("||", () => { const k: Msg = none[0] || t(); return sum(k) })
row("caught", () => { try { throw t() } catch (e) { const m: Msg = e as Msg; return sum(m) } })
row("a captured variable", () => { let m: Msg = own(1); const set = (x: any) => { m = x }; set(t()); return sum(m) })
'''
P['b08_what_is_read_in_a_loop_is_read_each_time'] = r'''
const raw = JSON.parse(full); const m: Msg = travel(raw)
function poke(i: number) { raw.id = i; raw.score = i / 2; raw.meta.hops = i * 2; if (i % 50 === 0) raw.tags = ["t" + i] }
row("numbers", () => { let s = 0; for (let i = 0; i < 3000; ++i) { poke(i); s += m.id + m.score! + m.meta!.hops } return s })
row("the array below", () => { let s = ""; for (let i = 0; i < 200; ++i) { poke(i); s = m.tags![0] } return s })
row("read, poked, read", () => { let s = 0; for (let i = 0; i < 3000; ++i) { const a = m.id; poke(i + 1); const b = m.id; s += b - a } return s })
row("an optional comes and goes", () => { let s = 0; for (let i = 0; i < 3000; ++i) { if (i % 2) raw.delay = i; else delete raw.delay; s += m.delay ?? 1 } return s })
row("own, through an untyped name", () => { const o = own(1); const u: any = o; let s = 0; for (let i = 0; i < 3000; ++i) { u.id = i; u.score = i / 2; s += o.id + o.score! } return s })
'''
P['b09_the_test_is_asked_each_time'] = r'''
const s1: Msg = travel(JSON.parse(line)), s2: Msg = travel(JSON.parse(full)), o1 = own(1), o2 = own(2)
row("one variable, four objects", () => { let s = 0; let w = o1; for (let i = 0; i < 4000; ++i) { w = i % 4 === 0 ? s1 : i % 4 === 1 ? o1 : i % 4 === 2 ? s2 : o2; s += w.id + (w.retries ?? 100) + (w.meta?.hops ?? 1000) } return s })
row("own 3000 times, then a stranger", () => { let s = 0; for (let i = 0; i < 3100; ++i) { const w = i < 3000 ? o1 : s1; s += w.id + (w.delay ?? 7) } return s })
row("a stranger 3000 times, then own", () => { let s = 0; for (let i = 0; i < 3100; ++i) { const w = i < 3000 ? s1 : o1; s += w.id + (w.delay ?? 7) } return s })
row("changed within the loop's body", () => { let s = 0; let w: Msg = o1; for (let i = 0; i < 3000; ++i) { s += w.id; w = w === o1 ? s2 : o1; s += w.id } return s })
function hot(w: Msg): number { return w.id * 2 + w.at + (w.score ?? 0.5) }
row("a small function", () => { let s = 0; for (let i = 0; i < 4000; ++i) s += hot(i % 3 ? o1 : s1); return s })
row("written in turn", () => { for (let i = 0; i < 4000; ++i) { const w = i % 2 ? o2 : s2; w.whenSent = i; w.score = (w.score ?? 0) + 1 } return sum(o2) + sum(s2) })
'''
P['b11_the_stranger_changes_its_form_meanwhile'] = r'''
row("members added while it is read", () => { const raw = JSON.parse(line); const m: Msg = travel(raw); let s = 0; for (let i = 0; i < 300; ++i) { raw["x" + i] = i; s += m.id + m.weight + (m.retries ?? 1) } return s })
row("members deleted while it is read", () => { const raw = JSON.parse(full); for (let i = 0; i < 50; ++i) raw["x" + i] = i; const m: Msg = travel(raw); let s = 0; for (let i = 0; i < 50; ++i) { delete raw["x" + i]; s += m.id + m.weight + (m.retries ?? 1) } return s })
row("members of the type written while others are added", () => { const raw = JSON.parse(line); const m: Msg = travel(raw); for (let i = 0; i < 300; ++i) { raw["x" + i] = i; m.score = i; m.retries = i } return raw.score + raw.retries + Object.keys(raw).length })
row("indexed members", () => { const raw = JSON.parse(line); const m: Msg = travel(raw); for (let i = 0; i < 100; ++i) raw[i] = i; return sum(m) + Object.keys(m).length })
row("prevented from growing, then written", () => { const raw = JSON.parse(line); const m: Msg = travel(raw); Object.preventExtensions(raw); m.id = 3; m.retries = 1; return sum(m) })
'''

for name, body in P.items():
    open(name + '.ts', 'w').write(HEAD.lstrip('\n') + body.lstrip('\n'))
print(len(P), 'programs')
n = 0
for name, body in P.items():
    lines = body.lstrip('\n').split('\n')
    rows = [i for i, l in enumerate(lines) if l.startswith('row(') and l.count('row(') == 1]
    if name[:3] in ('a15', 'a01', 'a06', 'b03', 'a09', 'a03', 'a02', 'a16'): continue
    for k, i in enumerate(rows):
        open('%s__%02d.ts' % (name[:3], k), 'w').write(HEAD.lstrip('\n') + '\n'.join(l for j, l in enumerate(lines) if j == i or j not in rows) + '\n'); n += 1
print(n, 'programs of one row')
