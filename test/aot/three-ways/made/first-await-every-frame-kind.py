#!/usr/bin/env python3
"""first-await-every-frame-kind.py <folder>: Every kind of thing awaited in every kind of frame, thousands alive at once, so that free lists run empty and the collector comes in between: first.ts, which prints one line of sums."""
import os, sys

os.makedirs(sys.argv[1], exist_ok=True)
os.chdir(sys.argv[1])
awaited = [  # (name, expression over a: number, s: string, o: Box, xs: number[], u: any), what is made of the result
 ('a_literal', '7'), ('an_integer', 'a'), ('a_fraction', 'a / 3'), ('a_sum', 'a + xs.length'), ('a_boolean', 'a > 1'), ('null', 'null'), ('undefined', 'undefined'),
 ('a_string', '"lit"'), ('a_parameter_string', 's'), ('a_rope', 's + a'), ('a_rope_of_three', 's + "-" + s'), ('a_template', '`${s}:${a}`'), ('a_character', 's[0]'), ('charAt', 's.charAt(1)'), ('a_slice', 's.slice(1)'), ('upper', 's.toUpperCase()'),
 ('an_array_literal', '[a, a + 1]'), ('an_object_literal', '{ p: a, q: s }'), ('a_nested_literal', '{ p: { q: [a] } }'), ('a_new_object', 'new Box(a)'), ('a_closure', '() => a'), ('a_field', 'o.n'), ('a_cell_field', 'o.next'), ('an_element', 'xs[a % xs.length]'), ('a_hole', 'xs[99]'),
 ('a_conditional', 'a % 2 ? s : a'), ('a_coalesce', 'o.next ?? o'), ('untyped', 'u'), ('untyped_member', 'u.k'), ('a_bigint', '10n'), ('a_regexp', '/x/g'), ('a_promise', 'Promise.resolve(a)'), ('a_promise_of_an_object', 'Promise.resolve({ p: a })'),
 ('a_call', 'id(a)'), ('a_call_that_allocates', 'fresh(a)'), ('an_async_call', 'leaf(a)'), ('a_thenable', '{ then(ok: (v: number) => void) { ok(a); } } as any'), ('a_map', 'new Map([[a, s]])'), ('a_spread', '[...xs, a]'), ('a_concat', 'xs.concat(a)'), ('json', 'JSON.parse("[" + a + "]")'), ('a_tuple', '[a, s] as [number, string]'), ('the_box_itself', 'o'), ('the_array_itself', 'xs'),
]
out = ['declare const console: { log(...values: any[]): void };', 'export { };',
 'class Box { next: Box | null = null; constructor(public n: number) { } async m(k: number): Promise<number> { const v = await k; return v + this.n; } static async s(k: number): Promise<number> { const v = await k; return v + 1; } }',
 'function id<T>(x: T): T { return x; }', 'function fresh(a: number): number[] { return [a, a, a]; }', 'async function leaf(a: number): Promise<number> { return a; }',
 'function weigh(v: unknown): number { if (typeof v === "number") return v | 0; if (typeof v === "string") return v.length; if (typeof v === "boolean") return v ? 1 : 2; if (v === null) return 3; if (v === undefined) return 4; if (typeof v === "bigint") return 5; if (typeof v === "function") return 6 + ((v as () => number)() | 0); if (Array.isArray(v)) return 7 + v.length; if (v instanceof Box) return 8 + v.n; if (v instanceof Map) return 9 + v.size; if (v instanceof RegExp) return 10; return 11 + Object.keys(v as object).length; }']
names = []
for name, e in awaited:
    # 1. a small frame: what is awaited stands right behind the frame's birth
    out.append('async function small_%s(a: number, s: string, o: Box, xs: number[], u: any): Promise<number> { const v = await (%s); return weigh(v) + a; }' % (name, e))
    # 2. a wide frame: cells, numbers, fractions, booleans alive across the await
    out.append('async function wide_%s(a: number, s: string, o: Box, xs: number[], u: any): Promise<number> { const c1 = s + "1", c2 = [a], c3 = { z: a }, n1 = a * 2, n2 = a / 7, b1 = a > 2, c4 = new Box(a + 1), c5 = xs.length, c6 = u; const v = await (%s); return weigh(v) + a + c1.length + c2[0] + c3.z + n1 + (n2 * 7 | 0) + (b1 ? 1 : 0) + c4.n + c5 + weigh(c6) + s.length + o.n + xs.length; }' % (name, e))
    # 3. in try | finally
    out.append('async function tried_%s(a: number, s: string, o: Box, xs: number[], u: any): Promise<number> { let r = 0; try { const v = await (%s); r = weigh(v); } catch (e) { r = -1; } finally { r += a; } return r + s.length; }' % (name, e))
    names += ['small_' + name, 'wide_' + name, 'tried_' + name]
extra = r'''
const arrow0 = async (): Promise<number> => { await 0; return 1; };
const arrowCapturing = (k: number, t: string) => async (a: number): Promise<number> => { const v = await (t + a); return v.length + k; };
async function notAtOnce(a: number, s: string): Promise<number> { let t = 0; for (let i = 0; i < 3; ++i) { if (i === a % 3) t += (await (s + i)).length; } return t + a; }
async function inABranch(a: number, s: string): Promise<number> { if (a % 2) { const v = await { p: a }; return v.p; } const w = await [s]; return w[0].length; }
async function inAnArgument(a: number): Promise<number> { return id((await { p: a }).p) + id(await a); }
async function withThreeDefaults(a: number, b: number = a + 1, c: string = "d" + a): Promise<number> { const v = await (c + b); return v.length + a + b; }
async function withRest(...r: number[]): Promise<number> { const v = await r; return v.length + r[0]; }
async function destructured({ p, q }: { p: number; q: string }, [x, y]: number[]): Promise<number> { const v = await (q + p); return v.length + x + y + p; }
async function sharedWithAClosure(a: number): Promise<number> { let n = a; const bump = () => { n += 1; }; bump(); const v = await { n }; bump(); return v.n + n; }
async function usesArguments(this: unknown, a: number): Promise<number> { const v = await arguments[0]; return v + arguments.length + a; }
async function throwsFirst(a: number): Promise<number> { if (a < 0) throw new Error("no"); const v = await a; return v; }
async function awaitsARejection(a: number): Promise<number> { try { await Promise.reject(new Error("r" + a)); return 0; } catch (e) { return (e as Error).message.length + a; } }
async function twice(a: number, s: string): Promise<number> { const v = await (s + a); const w = await { v }; return w.v.length + a; }
async function deep(n: number): Promise<number> { return n <= 0 ? await 0 : 1 + await deep(n - 1); }
async function manyCells(a: number): Promise<number> { const q0 = [a], q1 = [a], q2 = [a], q3 = [a], q4 = [a], q5 = [a], q6 = [a], q7 = [a], q8 = [a], q9 = [a], r0 = { a }, r1 = { a }, r2 = { a }, r3 = { a }, r4 = { a }, r5 = "s" + a, r6 = "t" + a, r7 = "u" + a; const v = await { a }; return v.a + q0[0] + q1[0] + q2[0] + q3[0] + q4[0] + q5[0] + q6[0] + q7[0] + q8[0] + q9[0] + r0.a + r1.a + r2.a + r3.a + r4.a + r5.length + r6.length + r7.length; }
async function* generates(n: number): AsyncGenerator<number> { for (let i = 0; i < n; ++i) yield await i; }
async function overAGenerator(n: number): Promise<number> { let t = 0; for await (const v of generates(n)) t += v; return t; }
'''
out.append(extra)
out.append('const given: any = (globalThis as any).arguments; const rounds: number = given && given.length ? +given[0] : 6; const each: number = given && given.length > 1 ? +given[1] : 40;')
out.append('const U: any[] = [1, "u", { k: 2 }, [3], null];')
out.append('async function main(): Promise<void> {')
out.append('  let total = 0; const shared = new Box(5); shared.next = new Box(6); const list = [1, 2, 3];')
out.append('  for (let r = 0; r < rounds; ++r) {')
out.append('    const alive: Promise<number>[] = [];')
out.append('    for (let i = 0; i < each; ++i) {')
out.append('      const a = r * 7 + i, s = "s" + i, u = { k: U[i % 5] };')
for n in names: out.append('      alive.push(%s(a, s, shared, list, u));' % n)
out.append('      alive.push(arrow0(), arrowCapturing(i, s)(a), notAtOnce(a, s), inABranch(a, s), inAnArgument(a), withThreeDefaults(a), withThreeDefaults(a, 2), withRest(a, 1, 2), destructured({ p: a, q: s }, [1, 2]), sharedWithAClosure(a), usesArguments(a), throwsFirst(a), throwsFirst(-1).catch(() => 1), awaitsARejection(a), twice(a, s), deep(i % 9), manyCells(a), overAGenerator(i % 4), shared.m(a), Box.s(a));')
out.append('    }')
out.append('    for (const v of await Promise.all(alive)) total = (total + v) % 1000000007;')
out.append('  }')
out.append('  console.log("total", total);')
out.append('}')
out.append('main().catch(e => console.log("FAILED", String(e)));')
open('first.ts', 'w').write('\n'.join(out) + '\n')
print(len(names) + 20, 'async functions')
