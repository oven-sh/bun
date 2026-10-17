#!/usr/bin/env python3
"""plain-data-narrowed-from-any.py <folder>: Plain data that is narrowed out of `unknown` or `any` may BECOME its closed type in its own cell. The ground: a field that a type parameter declares, filled by generic code with an ordinary object. One question a program: who could see that the cell has changed?"""
import os, sys

os.makedirs(sys.argv[1], exist_ok=True)
os.chdir(sys.argv[1])
H = os.getcwd()
head = '''declare const console: { log(...values: unknown[]): void };
declare const JSON: { parse(text: string): any; stringify(value: unknown): string };
type State = { count: number; name: string; list: number[]; extra?: number };
class Component<S> { state!: S; setState(part: Partial<S>): void { this.state = Object.assign({}, this.state, part); } raw(): unknown { return this.state } put(v: unknown): void { this.state = v as S } }
class Counter extends Component<State> {
  constructor() { super(); this.state = { count: 0, name: "n", list: [] }; }
  count(): number { return this.state.count; }
  label(): string { return this.state.name + this.state.list.length; }
  bump(): void { this.state.count++; }
}
function say(f: () => unknown) { try { console.log(String(f())) } catch (e) { console.log("THROWN: " + (e as Error).name + ": " + String((e as Error).message).split("\\n")[0].slice(0, 100)) } }
const c = new Counter();
'''
rows = {
 'read': 'c.setState({ count: 1 }); say(() => c.count() + " " + c.label());',
 'twice': 'c.setState({ count: 1 }); c.setState({ name: "m" }); say(() => c.count() + " " + c.label());',
 'identity': 'c.setState({ count: 1 }); const before = c.raw(); say(() => c.count()); say(() => before === c.raw());',
 'store_seen_by_the_other_holder': 'c.setState({ count: 1 }); const other = c.raw() as any; say(() => c.count()); c.bump(); say(() => other.count);',
 'the_other_holder_stores': 'c.setState({ count: 1 }); const other = c.raw() as any; say(() => c.count()); other.count = 7; say(() => c.count());',
 'the_other_holder_adds_a_property': 'c.setState({ count: 1 }); const other = c.raw() as any; say(() => c.count()); say(() => { other.more = 5; return other.more + " " + Object.keys(other).join() }); say(() => c.count());',
 'the_other_holder_deletes': 'c.setState({ count: 1 }); const other = c.raw() as any; say(() => c.count()); say(() => { delete other.name; return Object.keys(other).join() }); say(() => c.label());',
 'the_order_of_keys': 'c.put(JSON.parse(\'{"list":[1],"name":"j","count":3}\')); say(() => c.count() + " " + c.label()); say(() => Object.keys(c.raw() as object).join() + " " + JSON.stringify(c.raw()));',
 'more_than_the_type_names': 'c.put(JSON.parse(\'{"count":3,"zz":1,"name":"j","list":[],"yy":2}\')); say(() => c.count() + " " + c.label()); say(() => JSON.stringify(c.raw()));',
 'an_optional_one_comes_later': 'c.setState({ count: 1 }); say(() => c.count()); c.setState({ extra: 4 }); say(() => c.count() + " " + JSON.stringify(c.raw()));',
 'frozen': 'c.put(Object.freeze({ count: 3, name: "f", list: [] })); say(() => c.count() + " " + c.label()); say(() => Object.isFrozen(c.raw())); say(() => { "use strict"; c.bump(); return c.count() });',
 'a_getter': 'let n = 0; c.put({ get count() { return ++n }, name: "g", list: [] }); say(() => c.count() + " " + c.count() + " " + n);',
 'a_proxy': 'const seen: string[] = []; c.put(new Proxy({ count: 3, name: "p", list: [] }, { get(t: any, k) { seen.push(String(k)); return t[k] } })); say(() => c.count() + " " + c.label()); say(() => seen.join());',
 'inherited': 'c.put(Object.create({ count: 3, name: "i", list: [] })); say(() => c.count() + " " + c.label()); say(() => Object.keys(c.raw() as object).length);',
 'an_instance': 'class Other { count = 3; name = "o"; list: number[] = []; m() { return 1 } } const o = new Other(); c.put(o); say(() => c.count() + " " + c.label()); say(() => (c.raw() instanceof Other) + " " + o.m());',
 'a_null_prototype': 'const o = Object.assign(Object.create(null), { count: 3, name: "z", list: [] }); c.put(o); say(() => c.count() + " " + c.label()); say(() => Object.getPrototypeOf(c.raw()) === null);',
 'a_lie_in_a_member': 'c.put({ count: "three", name: "l", list: [] }); say(() => c.count()); say(() => c.label());',
 'a_member_is_missing': 'c.put({ count: 3 }); say(() => c.count()); say(() => c.label());',
 'no_object': 'c.put(5); say(() => c.count()); c.put(null); say(() => c.count());',
 'an_array': 'c.put([1, 2]); say(() => c.count()); say(() => Array.isArray(c.raw()));',
 'what_it_holds_is_shared': 'const list = [1, 2]; c.put({ count: 3, name: "s", list }); say(() => c.label()); list.push(3); say(() => c.label()); say(() => (c.raw() as any).list === list);',
 'in_a_weakmap_and_a_set': 'c.setState({ count: 1 }); const w = new WeakMap<object, number>(), s = new Set<unknown>(); w.set(c.raw() as object, 1); s.add(c.raw()); say(() => c.count()); say(() => w.get(c.raw() as object) + " " + s.has(c.raw()));',
 'many_turns': 'let sum = 0; for (let i = 0; i < 3000; i++) { c.setState({ count: i }); sum += c.count(); } say(() => sum + " " + c.label());',
 'a_predicate': 'function isState(x: unknown): x is State { return typeof x === "object" && x !== null && "count" in x } const u: unknown = JSON.parse(\'{"count":3,"name":"q","list":[]}\'); const kept = u; say(() => isState(u) ? u.count + u.name + u.list.length : "no"); say(() => kept === u);',
 'in': 'const u: State | { other: number } = JSON.parse(\'{"count":3,"name":"q","list":[]}\'); say(() => "count" in u ? u.count + u.name : u.other);',
}
for k, r in rows.items():
    open('%s/%s.ts' % (H, k), 'w').write(head + r + '\n')
print(len(rows))
