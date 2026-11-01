import { check } from "../src/show";
import { copiers as theirCopiers, makeTheirs, Theirs } from "fake-merge";
import { copiers as middleCopiers, makers, odd, sources, Settings, type Maker, type Options } from "../src/settings";
const F = "64";
const defaults: Options = { a: 1, b: "b", flag: false, mode: "off", ratio: 0.5, n: 0 };
const myCopiers: Record<string, (object: Options) => unknown> = {
  copy: object => ({ ...object }),
  overDefaults: (object): Options => ({ ...defaults, ...object }),
  underDefaults: (object): Options => ({ ...object, ...defaults }),
  assign: object => Object.assign({ n: 0 } as Options, object),
  assignTwo: object => Object.assign({}, defaults, object),
  rest: object => { const { a, ...others } = object; return [a, others]; },
  entries: object => Object.fromEntries(Object.entries(object)),
};
class Mine { a?: number; b?: string; mode: "on" | "off" = "on"; n = 63; constructor(i = 0) { if (i & 1) this.a = i; } }
const mine: Record<string, Maker> = {
  myOptions: (i): Options => (i & 1 ? { a: i, mode: "on", n: 2 } : { b: "s", flag: true, ratio: 1.5, n: 3, c: { x: i } }),
  myEveryOption: (i): Options => ({ a: i, b: "x", c: { x: 1, y: "y", z: null }, list: [i], flag: true, mode: i & 1 ? "on" : "off", ratio: i / 2, n: i }),
  myWrongTypes: (i): any => ({ a: "text", b: i, flag: "yes", mode: "neither", ratio: "half", n: null }),
  myFunctions: (i): any => ({ n: i, call: () => i, method() { return this.n; } }),
  mine: i => new Mine(i), mySubclass: i => new (class extends Settings { own = i })(i), theirs: makeTheirs, theirClass: i => new Theirs(i),
};
const all = Object.entries({ ...makers, ...sources, ...odd, ...mine });
const attempt = (body: () => unknown) => { try { return body(); } catch (error: any) { return "threw " + error.constructor.name; } };
// Each way of copying stands in each of the three images and is handed the objects of all three, the same kind many times over.
for (const [where, copiers] of [["the package", theirCopiers], ["the application", middleCopiers], ["the test file", myCopiers]] as const)
  for (const [how, copy] of Object.entries(copiers))
    check(F, `${how} in ${where}`, () => [1, 2, 3, 4, 5].map(i => all.map(([, make]) => attempt(() => copy(make(i))))));
check(F, "a copy is its own object", () => all.map(([, make]) => { const object = make(1), copy: any = middleCopiers.copy(object); copy.n = "changed"; copy.fresh = 1; return [object.n, "fresh" in object, Object.isFrozen(copy)]; }));
check(F, "functions in a copy are those of the source", () => [odd.functions(3), mine.myFunctions(4)].map(object => [theirCopiers, middleCopiers, myCopiers].map(copiers => { const copy: any = copiers.copy(object); return [copy.call === object.call, copy.call(), copy.method(), copy.method === object.method]; })));
check(F, "behind a collection", () => { Bun.gc(true); return all.map(([, make]) => attempt(() => [middleCopiers.overDefaults(make(2)), theirCopiers.overDefaults(make(3)), myCopiers.overDefaults(make(4))])); });
