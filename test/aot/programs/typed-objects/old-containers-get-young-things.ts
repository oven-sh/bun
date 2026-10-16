// OLD containers of every kind get YOUNG things: cells, and storage that holds no cells. After young collections and garbage of the same sizes everything must still be there.
declare const edenGC: undefined | (() => void);
const collectTheYoung = typeof edenGC === "function" ? edenGC : () => {};
function hide(value: unknown): any { return value; }
interface Leaf { n: number; s: string }
interface Node1 { id: number; leaf: Leaf | null; any: unknown; later?: Leaf; text: string; list: number[] }
class Holder { leaf: Leaf | null = null; #secret: Leaf | null = null; count = 0; static kept: Leaf | null = null; set(l: Leaf) { this.#secret = l; } get(): Leaf | null { return this.#secret; } }
const N = 4000;
const leaf = (i: number): Leaf => ({ n: i, s: "s" + i });
const plainLeaf = (i: number): any => JSON.parse('{"n":' + i + ',"s":"s' + i + '"}');
let sink = 0;
function churn(rounds: number) {
  for (let r = 0; r < rounds; r++) {
    for (let i = 0; i < 30000; i++) {
      const a = leaf(-i), b = plainLeaf(-i), c = [i, i + 1, i + 2, i + 3, i + 4], d = [a, b], e = "g" + i + "h", f: any = { p: a, q: b, r: c, s: d, t: e, u: i, v: i, w: i };
      const m = new Map<string, unknown>([[e, a]]), s = new Set<unknown>([b]);
      sink += c.length + d.length + e.length + f.u + m.size + s.size;
    }
    collectTheYoung();
  }
}
const results: string[] = [];
function check(name: string, wrongAt: (i: number) => boolean) { let wrong = 0, first = -1; for (let i = 0; i < N; i++) { let bad = true; try { bad = wrongAt(i); } catch { bad = true; } if (bad) { wrong++; if (first < 0) first = i; } } results.push(name + ": " + wrong + (wrong ? " first " + first : "")); }
const isLeaf = (l: any, i: number) => l !== null && l !== undefined && l.n === i && l.s === "s" + i;

const typedNodes: Node1[] = [], viaAny: Node1[] = [], byKey: Node1[] = [], created: Node1[] = [], extras: Node1[] = [];
const plains: any[] = [], plainsByKey: any[] = [], holders: Holder[] = [];
const arrays: unknown[][] = [], typedArrays: Leaf[][] = [], ints: number[][] = [], doubles: number[][] = [], byIndex: unknown[][] = [], intsByIndex: number[][] = [], unshifted: number[][] = [], spliced: unknown[][] = [];
const maps: Map<string, unknown>[] = [], objectMaps: Map<object, unknown>[] = [], sets: Set<unknown>[] = [], weak = new WeakMap<object, unknown>(), weakKeys: object[] = [], replaced: Map<string, unknown>[] = [], numberMaps: Map<number, number>[] = [];
const setters: ((l: Leaf) => void)[] = [], getters: (() => Leaf | null)[] = [];
const generators: Generator<Leaf | null, void, number>[] = [];
const texts: { t: string }[] = [], nested: { inner: { leaf: Leaf | null } }[] = [];
function* keep(): Generator<Leaf | null, void, number> { let held: Leaf | null = null; while (true) { const i: number = yield held; held = leaf(i); } }
for (let i = 0; i < N; i++) {
  const node = (): Node1 => ({ id: i, leaf: null, any: 0, text: "", list: [] });
  typedNodes.push(node()); viaAny.push(node()); byKey.push(node()); created.push(node()); extras.push(node());
  plains.push(JSON.parse('{"leaf":null,"other":0}')); plainsByKey.push(JSON.parse('{"leaf":null,"other":0}')); holders.push(new Holder());
  arrays.push([0]); typedArrays.push([]); ints.push([1, 2, 3]); doubles.push([1.5, 2.5, 3.5]); byIndex.push([0, 0]); intsByIndex.push([1, 2, 3]); unshifted.push([1, 2, 3]); spliced.push([0, 1, 2]);
  maps.push(new Map()); objectMaps.push(new Map()); sets.push(new Set()); weakKeys.push({ i }); replaced.push(new Map([["k", 0]])); numberMaps.push(new Map([[1, 1]]));
  let captured: Leaf | null = null; setters.push(l => { captured = l; }); getters.push(() => captured);
  const g = keep(); g.next(0); generators.push(g);
  texts.push({ t: "" }); nested.push({ inner: { leaf: null } });
}
let moduleLeaf: Leaf | null = null;
churn(3);
const key = ["leaf", "any", "later"], objectKeys: object[] = [];
for (let i = 0; i < N; i++) {
  typedNodes[i].leaf = leaf(i); typedNodes[i].any = plainLeaf(i); typedNodes[i].text = "t" + i + "x"; typedNodes[i].list = [i, i + 1];
  hide(viaAny[i]).leaf = leaf(i); hide(viaAny[i]).any = plainLeaf(i); hide(viaAny[i]).text = "t" + i + "x";
  hide(byKey[i])[key[0]] = leaf(i); hide(byKey[i])[key[1]] = plainLeaf(i);
  created[i].later = leaf(i); hide(extras[i]).zz = leaf(i); hide(extras[i])[Symbol.for("e")] = plainLeaf(i);
  plains[i].leaf = leaf(i); plains[i].other = plainLeaf(i); plainsByKey[i][key[0]] = leaf(i);
  holders[i].leaf = leaf(i); holders[i].set(leaf(i)); holders[i].count = i;
  arrays[i].push(leaf(i)); arrays[i][0] = plainLeaf(i); typedArrays[i].push(leaf(i)); typedArrays[i].push(leaf(i + 1));
  for (let k = 0; k < 9; k++) { ints[i].push(i + k); doubles[i].push(i + k + 0.5); intsByIndex[i][intsByIndex[i].length] = i + k; }
  byIndex[i][1] = leaf(i); byIndex[i][2] = plainLeaf(i); byIndex[i][3] = "t" + i;
  for (let k = 0; k < 6; k++) unshifted[i].unshift(i + k);
  spliced[i].splice(1, 1, leaf(i), plainLeaf(i), i, i, i, i);
  maps[i].set("k" + (i & 3), leaf(i)); const ok = { i }; objectKeys.push(ok); objectMaps[i].set(ok, leaf(i)); sets[i].add(leaf(i)); weak.set(weakKeys[i], leaf(i)); replaced[i].set("k", leaf(i));
  for (let k = 2; k < 12; k++) numberMaps[i].set(k, i + k);
  setters[i](leaf(i)); generators[i].next(i);
  texts[i].t = "a" + i + "b" + i; nested[i].inner.leaf = leaf(i);
}
moduleLeaf = leaf(7); Holder.kept = leaf(8);
churn(4);
check("a typed field, by its type", i => !isLeaf(typedNodes[i].leaf, i) || !isLeaf(typedNodes[i].any, i) || typedNodes[i].text !== "t" + i + "x" || typedNodes[i].list[1] !== i + 1);
check("a typed field, through any", i => !isLeaf(viaAny[i].leaf, i) || !isLeaf(viaAny[i].any, i) || viaAny[i].text !== "t" + i + "x");
check("a typed field, by a key", i => !isLeaf(byKey[i].leaf, i) || !isLeaf(byKey[i].any, i));
check("an optional field made later", i => !isLeaf(created[i].later, i));
check("extras of a typed object", i => !isLeaf(hide(extras[i]).zz, i) || !isLeaf(hide(extras[i])[Symbol.for("e")], i));
check("a plain object, by name", i => !isLeaf(plains[i].leaf, i) || !isLeaf(plains[i].other, i));
check("a plain object, by a key", i => !isLeaf(plainsByKey[i].leaf, i));
check("an instance: a field, a private field, a number", i => !isLeaf(holders[i].leaf, i) || !isLeaf(holders[i].get(), i) || holders[i].count !== i);
check("an array: push and a store", i => !isLeaf(arrays[i][1], i) || !isLeaf(arrays[i][0], i));
check("an array of a type", i => !isLeaf(typedArrays[i][0], i) || !isLeaf(typedArrays[i][1], i + 1));
check("integers pushed", i => ints[i].length !== 12 || ints[i][0] !== 1 || ints[i][11] !== i + 8 || ints[i][5] !== i + 2);
check("fractions pushed", i => doubles[i].length !== 12 || doubles[i][0] !== 1.5 || doubles[i][11] !== i + 8.5);
check("integers stored at the end", i => intsByIndex[i].length !== 12 || intsByIndex[i][2] !== 3 || intsByIndex[i][11] !== i + 8);
check("stores by index", i => !isLeaf(byIndex[i][1], i) || !isLeaf(byIndex[i][2], i) || byIndex[i][3] !== "t" + i);
check("unshift", i => unshifted[i].length !== 9 || unshifted[i][0] !== i + 5 || unshifted[i][8] !== 3);
check("splice", i => spliced[i].length !== 8 || !isLeaf(spliced[i][1], i) || !isLeaf(spliced[i][2], i) || spliced[i][7] !== 2);
check("a map by strings", i => !isLeaf(maps[i].get("k" + (i & 3)), i));
check("a map by objects", i => !isLeaf(objectMaps[i].get(objectKeys[i]), i));
check("a set", i => { for (const l of sets[i]) return !isLeaf(l, i); return true; });
check("a weak map", i => !isLeaf(weak.get(weakKeys[i]), i));
check("a value replaced in a map", i => !isLeaf(replaced[i].get("k"), i));
check("a map of numbers that grows", i => numberMaps[i].size !== 11 || numberMaps[i].get(1) !== 1 || numberMaps[i].get(11) !== i + 11);
check("a captured variable", i => !isLeaf(getters[i](), i));
check("a generator's frame", i => !isLeaf(generators[i].next(i).value, i));
check("a string made of parts", i => texts[i].t !== "a" + i + "b" + i);
check("an object within an object", i => !isLeaf(nested[i].inner.leaf, i));
results.push("a variable of the module, a static field: " + (isLeaf(moduleLeaf, 7) && isLeaf(Holder.kept, 8)));
for (const line of results) console.log(line);
console.log(sink > 0);
