// Untyped code asks `key in object` for optional declared fields of typed objects. The answer depends on the object, not on its Structure alone: the stub reads the field. It does not enter the runtime every time, and it follows what happens to the object and to its prototype chain.
declare const aotOperationCount: undefined | ((name: string) => number);
interface Options { id: number; text?: string; count?: number; whole?: number; flag?: boolean; inner?: { a: number }; any?: unknown; big?: bigint }
function full(i: number): Options { return { id: i, text: "t" + i, count: i + 0.5, whole: i, flag: i % 2 === 0, inner: { a: i }, any: i % 3 ? i : "s", big: 1n }; }
function bare(i: number): Options { return { id: i }; }
function withUndefined(i: number): Options { return { id: i, text: undefined, count: undefined, whole: undefined, flag: undefined, inner: undefined, any: undefined, big: undefined }; }
class Node { id: number; declare label?: string; declare weight?: number; constructor(id: number, label?: string) { this.id = id; if (label !== undefined) this.label = label; } grow(): void { this.weight = 1.5; } }
const names = ["text", "count", "whole", "flag", "inner", "any", "big"];
const asks: Record<string, (o: any) => any> = {
  text: function (o: any): any { return "text" in o; }, count: function (o: any): any { return "count" in o; }, whole: function (o: any): any { return "whole" in o; },
  flag: function (o: any): any { return "flag" in o; }, inner: function (o: any): any { return "inner" in o; }, any: function (o: any): any { return "any" in o; }, big: function (o: any): any { return "big" in o; },
  label: function (o: any): any { return "label" in o; }, weight: function (o: any): any { return "weight" in o; },
};
const askByKey: (o: any, k: any) => any = function (o: any, k: any): any { return k in o; };
const entered = (): number => typeof aotOperationCount === "function" ? aotOperationCount("operationAOTInByValAndCache") : 0;
const objects: Options[] = [];
for (let i = 0; i < 90; i++) objects.push(i % 3 === 0 ? full(i) : i % 3 === 1 ? bare(i) : withUndefined(i));
for (const name of names) {
  let yes = 0;
  for (const o of objects) yes += asks[name]!(o) ? 1 : 0;
  const before = entered();
  for (let round = 0; round < 20; round++) for (const o of objects) yes += (asks[name]!(o) ? 1 : 0) + (askByKey(o, name) ? 1 : 0);
  console.log(name, yes, entered() - before < 20);
}
const nodes: Node[] = [];
for (let i = 0; i < 90; i++) { nodes.push(new Node(i, i % 2 ? "n" : undefined)); if (i % 5 === 0) nodes[i]!.grow(); }
for (const name of ["label", "weight"]) {
  let yes = 0;
  for (const o of nodes) yes += asks[name]!(o) ? 1 : 0;
  const before = entered();
  for (let round = 0; round < 20; round++) for (const o of nodes) yes += asks[name]!(o) ? 1 : 0;
  console.log(name, yes, entered() - before < 20);
}
const answers = (o: object): string => names.map(name => (asks[name]!(o) ? "1" : "0") + (askByKey(o, name) ? "1" : "0")).join(" ");
const one = bare(1), loose: any = one;
console.log(answers(one), "|", answers(full(2)), "|", answers(withUndefined(3)));
loose.text = "now"; loose.count = 1; loose.flag = false; loose.any = undefined; loose.whole = 7;
console.log(answers(one));
delete loose.text; delete loose.count; delete loose.flag; delete loose.any; delete loose.whole;
console.log(answers(one));
const frozen = bare(9), frozenFull = full(10);
const freeze: (o: any) => any = function (o: any): any { return Object.freeze(o); };
for (let i = 0; i < 3; i++) answers(frozen), answers(frozenFull);
freeze(frozen);
freeze(frozenFull);
console.log(answers(frozen), "|", answers(frozenFull), "|", answers(one));
const above: any = { text: "inherited" };
const child = bare(5), sibling = full(6);
Object.setPrototypeOf(child, above);
Object.setPrototypeOf(sibling, above);
for (let i = 0; i < 3; i++) console.log(answers(child), "|", answers(sibling), "|", answers(one));
delete above.text;
above.count = 1;
console.log(answers(child), "|", answers(sibling), "|", answers(one));
(child as any).count = 2;
delete above.count;
console.log(answers(child), "|", answers(sibling));
delete (child as any).count;
console.log(answers(child), "|", answers(sibling));
const asked: string[] = [];
const watched = bare(7), alsoWatched = full(8);
const trap = new Proxy({}, { has(target, key) { asked.push(String(key)); return key === "flag"; } });
Object.setPrototypeOf(watched, trap);
Object.setPrototypeOf(alsoWatched, trap);
for (let i = 0; i < 2; i++) console.log(answers(watched), "|", answers(alsoWatched), "|", asked.splice(0).join());
const plainNode = new Node(100), labelled = new Node(101, "l");
const askNodes = (): string => ["label", "weight"].map(name => (asks[name]!(plainNode) ? "1" : "0") + (askByKey(plainNode, name) ? "1" : "0") + (asks[name]!(labelled) ? "1" : "0")).join(" ");
for (let i = 0; i < 3; i++) console.log(askNodes());
(Node.prototype as any).label = "from the prototype";
console.log(askNodes());
delete (Node.prototype as any).label;
console.log(askNodes());
Object.defineProperty(Node.prototype, "weight", { get() { return 1; }, configurable: true });
console.log(askNodes());
delete (Node.prototype as any).weight;
console.log(askNodes());
const top: any = {}, middle: any = Object.create(top), low = bare(11), lowFull = full(12);
Object.setPrototypeOf(low, middle);
Object.setPrototypeOf(lowFull, middle);
for (let i = 0; i < 3; i++) console.log(answers(low), "|", answers(lowFull));
top.whole = 1;
console.log(answers(low), "|", answers(lowFull));
delete top.whole;
console.log(answers(low), "|", answers(lowFull));
Object.setPrototypeOf(middle, { flag: 1 });
console.log(answers(low), "|", answers(lowFull));
Object.setPrototypeOf(middle, trap);
console.log(answers(low), "|", answers(lowFull), "|", asked.splice(0).join());
Object.setPrototypeOf(middle, null);
console.log(answers(low), "|", answers(lowFull), "|", asked.splice(0).join());
const marked = bare(13), markedLoose: any = marked;
markedLoose.extra = 1;
for (let i = 0; i < 3; i++) console.log(answers(marked), askByKey(marked, "extra"), askByKey(marked, "none"));
markedLoose.text = "t"; markedLoose.big = 2n;
console.log(answers(marked), askByKey(marked, "extra"));
delete markedLoose.extra; delete markedLoose.text;
console.log(answers(marked), askByKey(marked, "extra"));
const sealed = bare(14), sealedFull = full(15);
Object.seal(sealed); Object.preventExtensions(sealedFull);
for (let i = 0; i < 3; i++) console.log(answers(sealed), "|", answers(sealedFull));
const nullProto = bare(16);
Object.setPrototypeOf(nullProto, null);
for (let i = 0; i < 3; i++) console.log(answers(nullProto));
(nullProto as any).inner = { a: 1 };
console.log(answers(nullProto));
