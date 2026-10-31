import { check } from "../src/show";
import { Stack, Keeper, Lazy, Chained, Bytes } from "fake-shapes";
import { Pile, Ledger, Packet } from "../src/models";
const F = "08";
class Mine extends Ledger {}
Object.defineProperty(Mine, Symbol.species, { get: () => Keeper, configurable: true });
const kind = (v: object) => v.constructor.name;
check(F, "arrays", () => { const p = Pile.from([1, 2, 3]) as Pile<number>, l = Ledger.of(1, 2, 3) as Ledger, m = Mine.of(4, 5) as Mine; return [kind(p), kind(p.map(x => x)), kind(p.filter(Boolean)), kind(p.slice()), p.top(), p.bottom(), kind(l.map(x => x * 2)), (l.map(x => x * 2) as Ledger).average(), kind(l.concat([1])), kind(l.flatMap(x => [x])), kind(m.map(x => x)), kind(m.splice(0, 1)), m.length, Array.isArray(p), kind(new Stack<number>(2).fill(1).map(x => x))]; });
check(F, "length and holes", () => { const l = new Ledger(3); l[5] = 1; return [l.length, l.sum(), l, 4 in l, l.indexOf(1), kind(l.toSorted()), kind(l.toReversed()), kind(Array.from(l)), kind([...l])]; });
check(F, "promises", async () => { const a = Lazy.of(1), b = a.then(x => x + 1), c = Chained.resolve(1), d = c.then(x => x + 1), e = Chained.all([c, a]); return [kind(a), kind(b), kind(c), kind(d), (d as Chained<number>).label(), kind(e), await b, await d, await e, kind(c.finally(() => {})), kind((async () => c)())]; });
check(F, "typed arrays", () => { const p = new Packet([1, 2, 3, 250]), b = new Bytes(p.buffer, 1, 2); return [kind(p.map(x => x + 1)), kind(p.subarray(1)), kind(p.slice(1)), kind(p.filter(x => x > 1)), p.hex(), p.checksum(), (p.subarray(2) as Packet).checksum(), b.hex(), kind(Packet.from([9])), kind(Packet.of(1)), p instanceof Uint8Array, ArrayBuffer.isView(p), Object.prototype.toString.call(p)]; });
check(F, "regular expressions", () => { class Loud extends RegExp { override exec(s: string) { const m = super.exec(s); if (m) m[0] = m[0]!.toUpperCase(); return m; } } const r = new Loud("a+", "g"); return ["caaandaa".replace(r, m => "<" + m + ">"), "caaandaa".match(r), [..."caaandaa".matchAll(r)].map(m => m[0]), "a-b".split(new Loud("-")), kind(r)]; });
