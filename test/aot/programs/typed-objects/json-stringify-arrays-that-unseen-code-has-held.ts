// Records whose arrays went once through text that is evaluated at run time: nothing is proven of what the arrays hold, and the declared types are all that is known.
interface Rec { id: number; name: string; ok: boolean; tags: string[] }
interface Grid { rows: string[][]; sizes: number[]; flags: boolean[] }
interface Holder { list: Rec[]; last: string }
interface Mixed { values: (string | number | null)[]; end: number }

const word: string = process.argv[2] ?? "w";
const launder = new Function("v", "return v" + word.slice(word.length)) as <V>(v: V) => V;
const change = new Function("v", "f", "f(v); return v" + word.slice(word.length)) as <V>(v: V, f: (v: any) => void) => V;

let count = 0;
function show(name: string, make: () => unknown) {
  let out: string;
  try { out = String(make()); } catch (e) { out = "THROWN " + (e as Error).name + ": " + (e as Error).message; }
  console.log(String(++count).padStart(2, "0"), name + ":", out);
}

const rec = (i: number, tags: string[]): Rec => launder({ id: i, name: word + i, ok: (i & 1) === 1, tags });
function writeRec(r: Rec): string { return JSON.stringify(r); }
function writeGrid(g: Grid): string { return JSON.stringify(g); }
function writeHolder(h: Holder): string { return JSON.stringify(h); }
function writeMixed(m: Mixed): string { return JSON.stringify(m); }

show("two strings", () => writeRec(rec(1, [word, "b"])));
show("no element", () => writeRec(rec(2, [])));
show("one element", () => writeRec(rec(3, ["only"])));
show("strings that need escaping, wide strings, ropes", () => writeRec(rec(4, ['q"', "\\", "\n", "é", "значение", "\ud800", word.repeat(20) + count + word.repeat(20), ""])));
show("a hole in the middle", () => writeRec(rec(5, change(["a", "b", "c"], v => { delete v[1]; }))));
show("a hole at the end, by length", () => writeRec(rec(6, change(["a"], v => { v.length = 3; }))));
show("undefined, a function, a symbol among the elements", () => writeRec(rec(9, change(["a", "b", "c", "d"], v => { v[0] = undefined; v[1] = () => 1; v[2] = Symbol("s"); }))));
show("numbers, booleans, null in place of strings", () => writeRec(rec(10, change(["a", "b", "c", "d", "e"], v => { v[0] = 1; v[1] = 1.5; v[2] = true; v[3] = null; v[4] = -0; }))));
show("only integers in place of strings", () => writeRec(rec(11, launder([1, 2, 3] as unknown as string[]))));
show("only fractions in place of strings", () => writeRec(rec(12, launder([1.5, NaN, Infinity] as unknown as string[]))));
show("a bigint element", () => writeRec(rec(13, change(["a"], v => { v[0] = 1n; }))));
show("an element with toJSON, which gets its index", () => writeRec(rec(14, change(["a", "b"], v => { v[1] = { toJSON(k: string) { return typeof k + ":" + k; } }; }))));
show("an element whose toJSON answers undefined", () => writeRec(rec(15, change(["a", "b"], v => { v[0] = { toJSON() { return undefined; } }; }))));
show("an element whose toJSON shortens the array", () => {
  const tags = ["a", "b", "c", "d"];
  return writeRec(rec(16, change(tags, v => { v[1] = { toJSON() { tags.length = 2; return "cut"; } }; })));
});
show("an element whose toJSON lengthens the array", () => {
  const tags = ["a", "b"];
  return writeRec(rec(17, change(tags, v => { v[0] = { toJSON() { tags.push("late"); return "grown"; } }; })));
});
show("an element whose toJSON turns the strings into numbers", () => {
  const tags = ["a", "b", "c"];
  return writeRec(rec(18, change(tags, v => { v[0] = { toJSON() { v[1] = 1.5; v[2] = 7; return "first"; } }; })));
});
show("an element whose toJSON changes the record", () => {
  const r = rec(19, ["a", "b"]);
  change(r.tags, v => { v[0] = { toJSON() { (r as any).added = 1; delete (r as any).ok; return "x"; } }; });
  return writeRec(r) + " " + writeRec(r);
});
show("String objects among the strings", () => writeRec(rec(20, change(["a", "b"], v => { v[0] = new String("boxed"); v[1] = Object.assign(new String("own"), { toString() { return "by toString"; } }); }))));
show("a toJSON on String.prototype", () => {
  (String.prototype as any).toJSON = function () { return "T(" + this + ")"; };
  try { return writeRec(rec(21, ["a", "b"])); } finally { delete (String.prototype as any).toJSON; }
});
show("an own toJSON on the array", () => writeRec(rec(23, change(["a"], v => { v.toJSON = (k: string) => "own " + k; }))));
show("an own named property on the array", () => writeRec(rec(24, change(["a"], v => { v.extra = 1; }))));
show("a getter for an index", () => writeRec(rec(25, change(["a", "b"], v => { Object.defineProperty(v, 0, { get() { return "got"; }, enumerable: true, configurable: true }); }))));
show("a frozen array", () => writeRec(rec(26, Object.freeze(["a", "b"]) as string[])));
show("a sparse array", () => writeRec(rec(27, change(["a"], v => { v[5000] = "far"; })) ).length);
class Tags extends Array<string> { label = "l"; }
show("an instance of a class that extends Array", () => writeRec(rec(28, Tags.from(["a", "b"]) as string[])));
class TagsWithToJSON extends Array<string> { toJSON() { return "tags:" + this.join("+"); } }
show("an instance of a class that extends Array and has toJSON", () => writeRec(rec(29, TagsWithToJSON.from(["a", "b"]) as string[])));
show("a proxy of an array", () => {
  const seen: string[] = [];
  const text = writeRec(rec(30, new Proxy(["a", "b"], { get(t, k, r) { seen.push(String(k)); return Reflect.get(t, k, r); } })));
  return text + " " + seen.join();
});
show("a revoked proxy of an array", () => { const p = Proxy.revocable(["a"], {}); p.revoke(); return writeRec(rec(31, p.proxy)); });
show("an array of another realm's look: arguments, a typed array, an array-like", () => [
  writeRec(rec(32, (function (..._: string[]) { return arguments; })("a", "b") as unknown as string[])),
  writeRec(rec(33, new Uint8Array([1, 2]) as unknown as string[])),
  writeRec(rec(34, { length: 1, 0: "a" } as unknown as string[])),
].join(" "));
show("not an array at all", () => [null, undefined, () => 1, new Date(0), new Map([[1, 2]]), /x/, {}].map(v => writeRec(rec(35, v as unknown as string[]))).join(" "));
show("the array holds itself", () => { const tags: string[] = ["a"]; change(tags, v => { v.push(v); }); return writeRec(rec(36, tags)); });
show("the array holds the record", () => { const r = rec(37, ["a"]); change(r.tags, v => { v.push(r); }); return writeRec(r); });
show("the same array in two records", () => { const tags = launder(["s"]); return writeRec(rec(38, tags)) + writeRec(rec(39, tags)); });

show("nested arrays", () => writeGrid(launder({ rows: [[word, "b"], [], ["c"]], sizes: [1, 2.5, -0], flags: [true, false] })));
show("nested arrays with holes, strangers and arrays in place of strings", () => writeGrid(launder({
  rows: change([["a", "b"], ["c"], ["d"]], v => { delete v[0][0]; v[1] = "flat"; v[2][0] = ["deeper", [1]]; v.push(undefined, null, {}); }),
  sizes: change([1, 2, 3], v => { v[0] = "one"; delete v[1]; }),
  flags: change([true], v => { v[0] = 0; v.push("yes"); }),
})));
show("numbers of every storage", () => [[1, 2], [1.5, 2], [1, "x"], [], [2 ** 31], [-(2 ** 31) - 1], [1e21, 1e-7]].map(sizes => writeGrid(launder({ rows: [], sizes: sizes as number[], flags: [] }))).join(" "));

show("records in a list", () => writeHolder(launder({ list: [rec(40, ["a"]), rec(41, [])], last: "z" })));
show("strangers in a list of records", () => writeHolder(launder({
  list: change([rec(42, ["a"]), rec(43, ["b"]), rec(44, ["c"])], v => { v[0] = { id: 1 }; v[1] = JSON.parse('{"tags":["p"],"id":2,"z":[{}]}'); delete v[2].name; v.push(7, "s", [rec(45, [])]); }),
  last: "z",
})));
show("a record of the list has toJSON", () => writeHolder(launder({ list: change([rec(46, ["a"]), rec(47, ["b"])], v => { v[0].toJSON = function (k: string) { return [k, this.id]; }; }), last: "z" })));

show("a union of primitives", () => writeMixed(launder({ values: ["a", 1, null, 1.5, "b"], end: 1 })));
show("a union of primitives with strangers", () => writeMixed(launder({ values: change(["a", 1, null], v => { v.push(true, undefined, {}, [], 2n ** 0n === 1n ? "big" : "small"); }), end: 2 })));

show("many times over", () => {
  const r = rec(48, [word, "DELETE"]);
  let total = 0;
  for (let i = 0; i < 20000; i++) total += writeRec(r).length;
  r.tags.push("more");
  for (let i = 0; i < 20000; i++) total += writeRec(r).length;
  return total;
});
