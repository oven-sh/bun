const I = require("immutable");
const Rec = I.Record({ a: 1, b: "two" });
const NamedRec = I.Record({ x: 0 }, "Point");
const cases = {
  List: () => I.List([1, "two", { three: 3 }]),
  "empty List": () => I.List(),
  Map: () => I.Map({ a: 1, b: I.List([2]) }),
  "empty Map": () => I.Map(),
  "Map with object keys": () => I.Map([[{ k: 1 }, "v"]]),
  OrderedMap: () =>
    I.OrderedMap([
      ["z", 1],
      ["a", 2],
    ]),
  Set: () => I.Set([1, 2]),
  "empty Set": () => I.Set(),
  OrderedSet: () => I.OrderedSet(["z", "a"]),
  Stack: () => I.Stack([1, 2]),
  "Seq indexed": () => I.Seq([1, 2]),
  "Seq keyed": () => I.Seq({ a: 1 }),
  "Seq set": () => I.Seq.Set([1]),
  "lazy Seq": () => I.Seq([1, 2, 3]).map(x => x * 2),
  "lazy keyed Seq": () => I.Seq({ a: 1 }).map(x => x * 2),
  Range: () => I.Range(0, 3),
  Record: () => Rec({ a: 5 }),
  "named Record": () => NamedRec({ x: 2 }),
  nested: () => I.fromJS({ a: [1, { b: [2] }], c: {} }),
  "in an object": () => ({ list: I.List([1]), m: I.Map({ k: "v" }) }),
  "holds plain values": () => I.List([new Map([["a", 1]]), [1], () => {}, new Date(0)]),
};
describe("immutable", () => {
  for (const [name, make] of Object.entries(cases)) {
    test(name, () => {
      expect(make()).toMatchSnapshot();
    });
  }
});
