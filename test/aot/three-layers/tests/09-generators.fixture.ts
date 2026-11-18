import { check } from "../src/show";
import { range, callTwice } from "fake-shapes";
import { walk, tree, Vec2 } from "fake-typed";
import { Square, Vec3 } from "../src/models";
const F = "09";
function* twice<T>(inner: Iterable<T>): Generator<T, string, unknown> { for (const each of inner) { yield each; yield each; } return "twice done"; }
function* delegating(): Generator<number, string, unknown> { const a = yield* range(0, 2); const b = yield* twice(range(5, 6)); return a + "," + b; }
check(F, "for-of over a package generator", () => { const out: number[] = []; for (const each of range(0, 10, 3)) out.push(each); return [out, [...range(1, 4)], Array.from(range(0, 3), x => x * 2), Math.max(...range(0, 5))]; });
check(F, "next, return, throw", () => { const g = range(0, 10); const a = g.next(), b = g.next("skip"), c = g.return("early"), d = g.next(); const h = range(0, 3); h.next(); let thrown: unknown; try { h.throw(new Error("in")); } catch (e) { thrown = (e as Error).message; } return [a, b, c, d, thrown, h.next()]; });
check(F, "break closes", () => { const before = range.closed ?? 0; for (const each of range(0, 100)) if (each > 2) break; const [first] = range(7, 9); return [(range.closed ?? 0) - before, first]; });
check(F, "yield* across", () => { const g = delegating(); const out: unknown[] = []; for (let r = g.next(); ; r = g.next()) { out.push(r.value); if (r.done) break; } return out; });
check(F, "recursive typed walk", () => { const t = tree("a", tree("b", tree("c")), tree("d")); const g = walk(t); const seen: string[] = []; let r = g.next(); while (!r.done) { seen.push(r.value); r = g.next(); } return [seen, r.value, [...walk(tree(1, tree(2)))]]; });
check(F, "class iterators", () => [[...new Vec3(1, 2, 3)], [...new Vec2(4, 5)], [...new Square("s", 2).corners()], Object.fromEntries(new Square("s", 1).corners()), new Map(new Square("s", 3).corners()).get(3), new Set(new Vec3(1, 1, 2)).size]);
check(F, "destructuring", () => { const [x, , z = 9, w = 10] = new Vec3(1, 2, 3); const [[a, b], ...rest] = new Square("s", 1).corners(); return [x, z, w, a, b, rest.length]; });
check(F, "generator objects", () => { const g = range(0, 1); return [Object.prototype.toString.call(g), g[Symbol.iterator]() === g, typeof g.next, Object.getPrototypeOf(range).constructor.name, range.name, range.length, callTwice(() => [...range(0, 2)])]; });
check(F, "iterator helpers", () => [range(0, 10).filter(x => x % 2 === 0).map(x => x * x).take(3).toArray(), range(0, 5).drop(3).toArray(), range(1, 4).reduce((a, b) => a + b, 0), range(0, 3).flatMap(x => new Vec2(x, x)).toArray(), range(0, 9).some(x => x === 4), range(0, 9).find(x => x > 6)]);
