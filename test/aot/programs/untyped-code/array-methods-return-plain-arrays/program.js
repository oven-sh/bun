const D = typeof describe === "function" ? describe : null;
const sid = v => D ? (/StructureID: (\d+)/.exec(D(v)) || [, "?"])[1] : "";
const shape = v => D ? (/, ((?:CopyOnWrite)?ArrayWith\w+)[,\]]/.exec(D(v)) || [, "?"])[1] : "";
// The Structures of arrays made in ways that have nothing to do with the loops under test: an array in the making has none of them.
const known = new Set(); function learn() { if (!D) return; const grown = x => { const a = []; a.push(x); return a; }; const sparse = []; sparse[100000] = 1; const cut = []; cut[100000] = 1; cut.length = 0;
  for (const v of [[], [1, 2], [1.5, 2.5], ["a", "b"], [{}], new Array(), new Array(3), new Array(1, 2), new Array(1.5, 2.5), new Array("a", "b"), Array(0), Array.of(), Array.of(1), Array.of(1.5), Array.of("a"), grown(1), grown(1.5), grown("a"), grown({}), [1, 2].slice(), [1.5, 2.5].slice(), ["a"].slice(), [].slice(), [1].concat([2]), [1.5].concat([2.5]), ["a"].concat(["b"]), [].concat([]), sparse, cut, JSON.parse("[]"), JSON.parse("[1]"), JSON.parse("[1.5]"), JSON.parse('["a"]'), "a,b".split(","), Object.keys({ a: 1 })]) known.add(sid(v)); }
learn();
function row(name, f) { let r; try { r = f(); } catch (e) { console.log(name + ": threw " + e.name); return; } learn(); console.log(name + ": " + JSON.stringify(r) + " " + (!D || !Array.isArray(r) || known.has(sid(r)) ? "same" : "ANOTHER STRUCTURE (" + shape(r) + ")")); }
const ints = () => [3, 1, 2, 5, 4], dbls = () => [3.5, 1.5, 2.5], objs = () => ["c", "a", "b"], holes = () => [3, , 1, , 2], none = () => [], one = () => [7];
const big = n => Array.from({ length: n }, (_, i) => (i * 7) % n);
for (const [sn, src] of [["ints", ints], ["doubles", dbls], ["texts", objs], ["holes", holes], ["empty", none], ["one", one]]) {
  row("map " + sn, () => src().map(x => x));
  row("map to doubles " + sn, () => src().map(x => 0.5));
  row("map to texts " + sn, () => src().map(x => "t"));
  row("map, the kind changes on the way " + sn, () => src().map((x, i) => i === 0 ? 1 : i === 1 ? 1.5 : "t"));
  row("map to NaN " + sn, () => src().map((x, i) => i ? NaN : 1.5).map(x => String(x)));
  row("map to undefined " + sn, () => src().map(() => undefined).map(x => x === undefined));
  row("filter all " + sn, () => src().filter(() => true));
  row("filter none " + sn, () => src().filter(() => false));
  row("filter some " + sn, () => src().filter((x, i) => i % 2 === 0));
  row("Array.from " + sn, () => Array.from(src()));
  row("Array.from with a function " + sn, () => Array.from(src(), x => x));
  row("flatMap of values " + sn, () => src().flatMap(x => x));
  row("flatMap of arrays " + sn, () => src().flatMap(x => [x, x]));
  row("flatMap of nothing " + sn, () => src().flatMap(x => []));
  row("toSorted " + sn, () => src().toSorted());
  row("toSorted with a comparator " + sn, () => src().toSorted((a, b) => (a < b ? -1 : a > b ? 1 : 0)));
  row("sort " + sn, () => src().sort());
  row("sort with a comparator " + sn, () => src().sort((a, b) => (a < b ? -1 : a > b ? 1 : 0)));
  row("slice, concat, toReversed, toSpliced, with (the controls) " + sn, () => [src().slice(), src().concat([1]), src().toReversed(), src().toSpliced(0, 0)].flat());
}
row("map, the source shrinks", () => { const a = ints(); return a.map((x, i) => { if (i === 1) a.length = 2; return x; }); });
row("map, the source grows", () => { const a = ints(); return a.map((x, i) => { if (i === 1) a.push(9, 9, 9); return x; }); });
row("map, the source changes its kind", () => { const a = ints(); return a.map((x, i) => { if (i === 1) a[3] = "t"; return x; }); });
row("map, the source becomes sparse", () => { const a = ints(); return a.map((x, i) => { if (i === 1) a[100000] = 1; return x; }).length; });
row("filter, the source shrinks", () => { const a = ints(); return a.filter((x, i) => { if (i === 1) a.length = 2; return true; }); });
row("flatMap that grows past its first room", () => big(10).flatMap(x => [x, x, x, x, x, x, x, x]).length);
row("flatMap, kinds by turns", () => [1, 2, 3, 4].flatMap((x, i) => i % 2 ? [x + 0.5] : ["t", x]));
row("a thousand", () => big(1000).map(x => x + 1).filter(x => x % 2).toSorted((a, b) => a - b).slice(0, 5));
row("map of a thousand, adopted", () => { const r = big(1000).map(x => x + 1); r.length = 3; return r; });
row("toSorted of a thousand, adopted", () => { const r = big(1000).toSorted((a, b) => a - b); r.length = 3; return r; });
row("filter of a thousand, adopted", () => { const r = big(1000).filter(x => x < 3); return r; });
row("a comparator that throws, caught, then again", () => { const a = ints(); try { a.toSorted(() => { throw 1; }); } catch (e) {} return a.toSorted((x, y) => x - y); });
row("a callback that throws, caught, then again", () => { const a = ints(); try { a.map(() => { throw 1; }); } catch (e) {} return a.map(x => x); });
row("nested", () => ints().map(x => ints().map(y => x * y).filter(z => z > 10).toSorted((p, q) => p - q)).flat());
row("nested, the inner results", () => ints().map(x => ints().map(y => x * y))[2]);
row("a literal of forty that are no constants", () => { const f = x => x; return [f(1), f(2), f(3), f(4), f(5), f(6), f(7), f(8), f(9), f(10), f(11), f(12), f(13), f(14), f(15), f(16), f(17), f(18), f(19), f(20), f(21), f(22), f(23), f(24), f(25), f(26), f(27), f(28), f(29), f(30), f(31), f(32), f(33), f(34), f(35), f(36), f(37), f(38), f(39), f(40)]; });
row("a literal of forty objects", () => { const f = x => ({ x }); const r = [f(1), f(2), f(3), f(4), f(5), f(6), f(7), f(8), f(9), f(10), f(11), f(12), f(13), f(14), f(15), f(16), f(17), f(18), f(19), f(20), f(21), f(22), f(23), f(24), f(25), f(26), f(27), f(28), f(29), f(30), f(31), f(32), f(33), f(34), f(35), f(36), f(37), f(38), f(39), f(40)]; r.length = 2; return r; });
row("hot", () => { let r; for (let i = 0; i < 300; i++) r = ints().map(x => x + i).filter(x => x % 2).toSorted((a, b) => a - b); return r; });
