// A member keyed by a constant that holds Symbol.for("key") is a field of the layout; every other way to the same symbol reaches the same field.
// IR+ ^layout L[0-9]+ .*\{name=RegisteredSymbol "[^"]*test.tag" declared=undefined.null.string
// IR= 0 read ElemGet
// IR= 1 read : undefined.null.string = PropGet v[0-9]+ name=RegisteredSymbol "[^"]*test.tag"
import { readHere, readLoosely, type TaggedHere } from "./other";
const kTag = Symbol.for("test.tag");
const kCount = Symbol.for("test.count");
interface Tagged {
  n: number;
  [kTag]: string;
  [kCount]?: number;
}
class Holder {
  [kTag]: string = "held";
  n = 7;
}
function read(value: Tagged): string {
  return value[kTag] + value.n;
}
function inFunction(value: Tagged): number | undefined {
  const kLocal = Symbol.for("test.count");
  return (value as any)[kLocal];
}
(globalThis as { kept?: unknown }).kept = [read, inFunction];
const tagged: Tagged = { n: 1, [kTag]: "a" };
console.log(read(tagged), read(new Holder()), inFunction(tagged), Symbol.keyFor(kTag), kTag === Symbol.for("test.tag"), kTag.description);
tagged[kCount] = 5;
console.log(inFunction(tagged), Reflect.ownKeys(tagged).map(String).join(), Object.getOwnPropertySymbols(tagged)[0] === Symbol.for("test.tag"));
console.log(readLoosely(tagged), readLoosely(new Holder()), readLoosely({ [Symbol.for("test.tag")]: "plain" }));
const here: TaggedHere = { n: 2, [Symbol.for("test.tag") as any]: "b" } as unknown as TaggedHere;
console.log(readHere(here), readHere(tagged as unknown as TaggedHere), read(here as unknown as Tagged));
(tagged as any)[Symbol.for("test.tag")] = "stored";
console.log(read(tagged), delete tagged[kCount], kCount in tagged, JSON.stringify(tagged), JSON.stringify({ ...tagged }), ({ ...tagged })[kTag]);
