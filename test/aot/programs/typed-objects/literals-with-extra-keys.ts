// Object literals of declared types with keys that the types do not have, computed or spread in, ahead of the declared ones, between them and behind them: the keys keep their order, the values their places.
const show = (label: string, value: unknown) => console.log(label + ": " + JSON.stringify(value));

interface Point {
  x: number;
  y: number;
}
interface Named {
  id: number;
  label?: string;
}
const behind = (key: string, v: unknown): Point => ({ x: 1, y: 2, [key]: v });
const ahead = (key: string, v: unknown): Point => ({ [key]: v, x: 1, y: 2 });
const between = (key: string, v: unknown): Point => ({ x: 1, [key]: v, y: 2 });
const twice = (first: string, second: string, v: unknown): Point => ({ [first]: v, x: 1, y: 2, [second]: v });
const spreadIn = (more: object): Point => ({ x: 1, ...more, y: 2 });
const withoutOptional = (key: string, v: unknown): Named => ({ id: 1, [key]: v });
const withOptional = (key: string, v: unknown): Named => ({ id: 1, [key]: v, label: "l" });
const bySymbol = (key: symbol, v: unknown): Point => ({ x: 1, [key]: v, y: 2 });
const byIndex = (key: number, v: unknown): Point => ({ x: 1, y: 2, [key]: v });
const cast = (o: object): Point => o as Point;
const describe = (o: any) => [Object.keys(o).join(), JSON.stringify(o), Reflect.ownKeys(o).length, o.x ?? o.id, o.extra, o.k0];
const mark = Symbol("mark");

for (let round = 0; round < 5; round++) {
  const key = "k" + (round % 2);
  show("behind " + round, describe(behind(key, round)));
  show("ahead " + round, describe(ahead(key, round)));
  show("between " + round, describe(between(key, round)));
  show("twice " + round, describe(twice(key, "extra", round)));
  show("the same key twice " + round, describe(twice(key, key, round)));
  show("a declared name by key " + round, [describe(behind("x", round + 10)), describe(ahead("y", round + 10)), describe(between("y", round + 10))]);
  show("spread " + round, describe(spreadIn({ [key]: round, extra: [round] })));
  show("spread over " + round, describe(spreadIn({ x: round + 20, y: round + 30, extra: null })));
  show("without the optional " + round, describe(withoutOptional(key, round)));
  show("the optional by key " + round, describe(withoutOptional("label", "by key")));
  show("with the optional " + round, describe(withOptional(key, round)));
  show("symbol " + round, [describe(bySymbol(mark, round)), (bySymbol(mark, round) as any)[mark]]);
  show("index " + round, describe(byIndex(round, "at " + round)));
  show("held values " + round, describe(behind(key, { held: [round, { deep: key }] })));
  show("undefined and null " + round, [describe(behind(key, undefined)), describe(behind(key, null))]);
  const plain: any = { x: 1, y: 2 };
  plain[key] = round;
  plain.extra = "e";
  const same = cast(plain);
  show("cast " + round, [describe(same), same === plain]);
  const first: any = {};
  first[key] = round;
  first.y = 2;
  first.x = 1;
  show("cast in another order " + round, [describe(cast(first)), cast(first) === first]);
}

const kept: any[] = [];
for (let i = 0; i < 400; i++) kept.push(i % 3 === 0 ? behind("k" + (i % 50), i) : i % 3 === 1 ? ahead("k" + (i % 50), i) : between("w" + i, i));
let sum = 0, keys = "";
for (const o of kept) {
  for (const key in o) sum += typeof o[key] === "number" ? o[key] : 0;
  keys = Object.keys(o).join();
}
show("many", [sum, keys, Object.keys(kept[300]).join(), Object.keys(kept[301]).join(), { ...kept[302] }, structuredClone(kept[303])]);
for (const o of kept) {
  o.extra = 1;
  delete o.x;
}
show("changed", [Object.keys(kept[300]).join(), Object.keys(kept[301]).join(), Object.keys(kept[302]).join(), kept.reduce((n, o) => n + o.extra + o.y, 0)]);
