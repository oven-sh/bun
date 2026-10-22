// Untyped code asks Object.hasOwn and hasOwnProperty for optional declared fields of typed objects. The answer depends on the object, not on its Structure alone: a stub reads the field. It does not enter the runtime every time, and it follows what happens to the object; what the prototype chain has does not matter.
declare const aotOperationCount: undefined | ((name: string) => number);
interface Options { id: number; text?: string; count?: number; whole?: number; flag?: boolean; inner?: { a: number }; any?: unknown; big?: bigint }
function full(i: number): Options { return { id: i, text: "t" + i, count: i + 0.5, whole: i, flag: i % 2 === 0, inner: { a: i }, any: i % 3 ? i : "s", big: 1n }; }
function bare(i: number): Options { return { id: i }; }
function withUndefined(i: number): Options { return { id: i, text: undefined, count: undefined, whole: undefined, flag: undefined, inner: undefined, any: undefined, big: undefined }; }
class Node { id: number; declare label?: string; declare weight?: number; constructor(id: number, label?: string) { this.id = id; if (label !== undefined) this.label = label; } grow(): void { this.weight = 1.5; } }
const names = ["text", "count", "whole", "flag", "inner", "any", "big"];
const asks: Record<string, (o: any) => any> = {
  text: function (o: any): any { return Object.hasOwn(o, "text"); }, count: function (o: any): any { return Object.hasOwn(o, "count"); }, whole: function (o: any): any { return Object.hasOwn(o, "whole"); },
  flag: function (o: any): any { return Object.hasOwn(o, "flag"); }, inner: function (o: any): any { return Object.hasOwn(o, "inner"); }, any: function (o: any): any { return Object.hasOwn(o, "any"); }, big: function (o: any): any { return Object.hasOwn(o, "big"); },
  label: function (o: any): any { return Object.hasOwn(o, "label"); }, weight: function (o: any): any { return Object.hasOwn(o, "weight"); },
};
const byMethod: Record<string, (o: any) => any> = {
  text: function (o: any): any { return o.hasOwnProperty("text"); }, count: function (o: any): any { return o.hasOwnProperty("count"); }, whole: function (o: any): any { return o.hasOwnProperty("whole"); },
  flag: function (o: any): any { return o.hasOwnProperty("flag"); }, inner: function (o: any): any { return o.hasOwnProperty("inner"); }, any: function (o: any): any { return o.hasOwnProperty("any"); }, big: function (o: any): any { return o.hasOwnProperty("big"); },
};
const entered = (): number => typeof aotOperationCount === "function" ? aotOperationCount("operationAOTHasOwnProperty") : 0;
const objects: Options[] = [];
for (let i = 0; i < 90; i++) objects.push(i % 3 === 0 ? full(i) : i % 3 === 1 ? bare(i) : withUndefined(i));
let read = 0;
for (const o of objects) read += o.id + (o.text?.length ?? 0) + (o.count ?? 0) + (o.whole ?? 0) + (o.flag ? 1 : 0) + (o.inner?.a ?? 0) + (o.big === undefined ? 0 : 1);
console.log(read);
for (const name of names) {
  let yes = 0;
  for (const o of objects) yes += asks[name]!(o) ? 1 : 0;
  const before = entered();
  for (let round = 0; round < 20; round++) for (const o of objects) yes += asks[name]!(o) ? 1 : 0;
  console.log(name, yes, entered() - before < 20);
}
const nodes: Node[] = [];
for (let i = 0; i < 90; i++) { nodes.push(new Node(i, i % 2 ? "n" : undefined)); if (i % 5 === 0) nodes[i]!.grow(); }
for (const name of ["label", "weight"]) {
  let yes = 0;
  for (const o of nodes) yes += asks[name]!(o) ? 1 : 0;
  for (let round = 0; round < 20; round++) for (const o of nodes) yes += asks[name]!(o) ? 1 : 0;
  console.log(name, yes);
}
const answers = (o: object): string => names.map(name => (asks[name]!(o) ? "1" : "0") + (byMethod[name]!(o) ? "1" : "0")).join(" ");
const one = bare(1), loose: any = one;
console.log(answers(one), "|", answers(full(2)), "|", answers(withUndefined(3)));
loose.text = "now"; loose.count = 1; loose.flag = false; loose.any = undefined; loose.whole = 7;
console.log(answers(one));
delete loose.text; delete loose.count; delete loose.flag; delete loose.any; delete loose.whole;
console.log(answers(one));
const frozen = bare(9), frozenFull = full(10);
Object.freeze(frozen); Object.freeze(frozenFull);
console.log(answers(frozen), "|", answers(frozenFull));
const above: any = { text: "inherited", count: 1 };
const child = bare(5), sibling = full(6);
Object.setPrototypeOf(child, above);
Object.setPrototypeOf(sibling, above);
for (let i = 0; i < 3; i++) console.log(answers(child), "|", answers(sibling), "|", answers(one), (child as any).text);
(child as any).count = 2;
console.log(answers(child), "|", answers(sibling));
delete (child as any).count;
console.log(answers(child), "|", answers(sibling));
const marked = bare(13), markedLoose: any = marked;
markedLoose.extra = 1;
for (let i = 0; i < 3; i++) console.log(answers(marked), Object.hasOwn(marked, "extra"), Object.hasOwn(marked, "none"));
markedLoose.text = "t"; markedLoose.big = 2n;
console.log(answers(marked));
delete markedLoose.extra; delete markedLoose.text;
console.log(answers(marked));
const nullProto = bare(16);
Object.setPrototypeOf(nullProto, null);
console.log(names.map(name => asks[name]!(nullProto) ? "1" : "0").join(" "));
const plain: any = { id: 1, text: "t" }, host: any = new Map(), list: any = ["a"], fn: any = function () {};
for (const other of [plain, host, list, fn, "text", 5, true, Symbol.iterator, 1n]) console.log(names.map(name => asks[name]!(other) ? "1" : "0").join(" "));
for (const nothing of [undefined, null]) { try { asks.text!(nothing); } catch (error) { console.log((error as Error).name); } }
