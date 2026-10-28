// A typed file hands its records to functions that it imports from a JavaScript file of the same program. The records stay laid out by their types, and typed code reads their fields in place. The JavaScript reads and stores by name,
// and whatever it does to a record (a property more, one less, an accessor, another prototype, freezing it, an object of its own making stored into a field) is seen by typed code as it is under plain Bun.
// IR= 1 total : number = PropGet v[0-9]+ name="value"(?!.* isFallback)
// IR= 2 total : undefined\|null\|=?L[0-9]+!? = PropGet v[0-9]+ name="(left|right)"(?!.* isFallback)
// IR= 2 half : number = PropGet v[0-9]+ name="(count|total)"(?!.* isFallback)
// IR+ : =?L[0-9]+ = NewObject 
import { held, hold, same, identity, graftKept, changeKept, extendKept, graftTyped, swap, setInMap, addToSet, pushInto, replaceAt, sortByX, mapToSums, keysOf, copyOf, assignTo, entriesOf, resolveLater, thenMake, callWith, callMethod, View, setOptional, clearOptional, setUnion, nest, weakly, describeType, destructure, viaArguments, viaApply, increment, big, negativeZero, notANumber, walk, scale, remove, extend, accessor, freeze, reparent } from "./library.js";
interface Point { x: number; y: number }
interface Tree { value: number; left: Tree | undefined; right: Tree | undefined }
interface Pair { first: Point; second: Point }
interface Labeled { id: number; label?: string }
interface Either { kind: "a" | "b"; data: Point | number }
interface Outer { inner: { point: Point } }
interface Counter { count: number; total: number }
interface Options { size: Point; title: string }
class Mover { at: Point = { x: 0, y: 0 }; move(by: Point): number { this.at = by; return this.at.x + by.y; } }
function leaf(value: number): Tree { return { value, left: undefined, right: undefined }; }
function total(tree: Tree | undefined): number { return tree ? tree.value + total(tree.left) + total(tree.right) : 0; }
function sum(point: Point): number { return point.x + point.y; }
const point = (x: number, y: number): Point => ({ x, y });
const say = (make: () => unknown) => { try { return String(make()); } catch (e) { return (e as Error).name + ": " + (e as Error).message; } };
const p = point(1, 2);
console.log("identity", say(() => same(hold(p), p)), say(() => identity(p) === p), say(() => { const back: Point = identity(p); return sum(back) + " " + (back === p); }));
const t = leaf(1);
console.log("graftKept", say(() => graftKept(t)), say(() => total(t)), say(() => changeKept(5)), say(() => total(t)), say(() => t.left!.value), say(() => same(held.length - 1, t.left)), say(() => { t.left!.value = 1; return changeKept(0); }), say(() => extendKept()), say(() => total(t)), say(() => JSON.stringify(t)));
const t2 = leaf(2), t3 = leaf(3);
console.log("graftTyped", say(() => graftTyped(t2, t3)), say(() => total(t2)), say(() => t2.right === t3));
const pair: Pair = { first: point(1, 1), second: point(2, 2) }, wasFirst = pair.first;
console.log("swap", say(() => swap(pair) === pair), say(() => pair.second === wasFirst), say(() => sum(pair.first) + " " + sum(pair.second)));
const map = new Map<string, Point>([["a", point(1, 1)]]);
console.log("map", say(() => setInMap(map, "b")), say(() => sum(map.get("b")!)), say(() => same(held.length - 1, map.get("b"))), say(() => [...map.values()].map(sum).join()));
const set = new Set<Point>([point(5, 5)]);
console.log("set", say(() => addToSet(set)), say(() => [...set].map(sum).join()));
const list: Point[] = [point(1, 1), point(4, 4)];
console.log("list", say(() => pushInto(list)), say(() => list.map(sum).join()), say(() => same(held.length - 1, list[2])), say(() => replaceAt(list, 0)), say(() => list.map(sum).join()), say(() => sortByX(list) === list), say(() => list.map(q => q.x).join()), say(() => mapToSums(list).join()));
let loop = 0; for (const q of list) loop += q.x * q.y; console.log("loop", loop);
console.log("keys", say(() => keysOf(p)), say(() => keysOf(t2)), say(() => entriesOf(pair)), say(() => entriesOf(t2)));
console.log("copy", say(() => { const c: Point = copyOf(p); return sum(c) + " " + (c !== p); }), say(() => { const target = point(0, 0); return (assignTo(target, p) === target) + " " + sum(target); }), say(() => { const target = point(0, 0); assignTo(target, { x: 9 }); return sum(target); }), say(() => JSON.stringify(assignTo({}, p))));
console.log("callWith", say(() => callWith(sum, 3, 4)), say(() => callWith((q: Point) => { q.x = 10; return sum(q); }, 1, 1)), say(() => held[held.length - 1].x), say(() => { let kept: Point | undefined; callWith((q: Point) => { kept = q; }, 6, 6); return same(held.length - 1, kept) + " " + sum(kept!); }));
const mover = new Mover();
console.log("method", say(() => callMethod(mover, 4)), say(() => sum(mover.at)));
const options: Options = { size: point(10, 20), title: "t" };
console.log("class", say(() => { const view = new View(options); return view.width() + " " + (view.options === options) + " " + view.grow().width(); }), say(() => sum(options.size)), say(() => options.title));
const labeled: Labeled = { id: 1 };
console.log("optional", say(() => labeled.label), say(() => setOptional(labeled).label), say(() => labeled.label), say(() => Object.keys(labeled).join()), say(() => clearOptional(labeled).label), say(() => labeled.label === undefined), say(() => Object.keys(labeled).join()), say(() => "label" in labeled));
const either: Either = { kind: "b", data: 1 };
console.log("union", say(() => setUnion(either, true).kind), say(() => either.kind === "a" && typeof either.data === "object" ? sum(either.data) : -1), say(() => setUnion(either, false).kind), say(() => typeof either.data === "number" ? either.data : -1));
const outer: Outer = { inner: { point: point(1, 1) } }, wasInner = outer.inner;
console.log("nest", say(() => nest(outer) === outer), say(() => sum(outer.inner.point)), say(() => sum(wasInner.point)), say(() => outer.inner !== wasInner));
console.log("odds", say(() => weakly(p)), say(() => describeType(p)), say(() => destructure(p)), say(() => viaArguments(p, 1)), say(() => viaApply(sum, p)));
const counter: Counter = { count: 0, total: 0 };
console.log("numbers", say(() => increment(counter).count), counter.count, counter.total, say(() => big(counter).count), counter.count + 1, say(() => Object.is(negativeZero(counter).count, -0)), Object.is(counter.count, -0), 1 / counter.count, say(() => notANumber(counter).total), counter.total !== counter.total);
function half(counter: Counter): number { return (counter.count + counter.total) / 2; }
function build(depth: number): Tree { return { value: depth, left: depth ? build(depth - 1) : undefined, right: depth ? build(depth - 1) : undefined }; }
const tree = build(6);
console.log("walk", walk(tree, 0), total(tree), half({ count: 1, total: 2 }));
const scaled = point(1, 2);
console.log("scale", say(() => scale(scaled, 3) === scaled), sum(scaled), scaled.x, scaled.y);
const removed = point(1, 2);
console.log("remove", say(() => remove(removed) === removed), say(() => removed.x), say(() => sum(removed)), say(() => Object.keys(removed).join()), say(() => "x" in removed));
const extended = point(1, 2);
console.log("extend", say(() => extend(extended) === extended), say(() => sum(extended)), say(() => Object.keys(extended).join()), say(() => JSON.stringify(extended)));
const watched = point(1, 2);
console.log("accessor", say(() => accessor(watched) === watched), say(() => watched.x), say(() => watched.x), say(() => sum(watched)));
const frozen = point(1, 2);
console.log("freeze", say(() => freeze(frozen) === frozen), say(() => { frozen.x = 5; return frozen.x; }), say(() => Object.isFrozen(frozen)), say(() => sum(frozen)));
const adopted = point(1, 2);
console.log("reparent", say(() => reparent(adopted) === adopted), say(() => (adopted as any).inherited), say(() => sum(adopted)), say(() => Object.getPrototypeOf(adopted) === Object.prototype));
async function later() {
  const back: Point = await resolveLater(p); console.log("promise", back === p, sum(back));
  const made: Point = await thenMake(); console.log("promise made", sum(made), JSON.stringify(made));
}
later().then(() => {
  let turns = 0;
  const many: Point[] = []; for (let i = 0; i < 100; i++) many.push(point(i, i));
  for (let i = 0; i < 300; i++) { turns += mapToSums(many).length + sum(identity(many[i % 100])) + total(t2); pushInto(many); many.pop(); }
  console.log("turns", turns);
});
