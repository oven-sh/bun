// Untyped code deletes optional declared fields from fresh typed objects. The delete is cached by the object's Structure and key order: a stub clears the field. It does not enter the runtime every time, and the keys, their order and later stores are as in plain JavaScript.
declare const aotOperationCount: undefined | ((name: string) => number);
interface Options { id: number; text?: string; count?: number; whole?: number; flag?: boolean; inner?: { a: number }; any?: unknown; big?: bigint }
function full(i: number): Options { return { id: i, text: "t" + i, count: i + 0.5, whole: i, flag: i % 2 === 0, inner: { a: i }, any: i % 3 ? i : "s", big: 1n }; }
function reversed(i: number): Options { return { big: 2n, any: i, inner: { a: i }, flag: true, whole: i, count: i + 0.25, text: "r", id: i }; }
function some(i: number): Options { return { id: i, text: "s", flag: false }; }
class Node { id: number; declare label?: string; declare weight?: number; constructor(id: number, label?: string) { this.id = id; if (label !== undefined) this.label = label; } }
const names = ["text", "count", "whole", "flag", "inner", "any", "big"];
const removes: Record<string, (o: any) => any> = {
  text: function (o: any): any { return delete o.text; }, count: function (o: any): any { return delete o.count; }, whole: function (o: any): any { return delete o.whole; },
  flag: function (o: any): any { return delete o.flag; }, inner: function (o: any): any { return delete o.inner; }, any: function (o: any): any { return delete o.any; }, big: function (o: any): any { return delete o.big; },
  label: function (o: any): any { return delete o.label; },
};
const removeByKey: (o: any, k: any) => any = function (o: any, k: any): any { return delete o[k]; };
const entered = (): number => typeof aotOperationCount === "function" ? aotOperationCount("operationAOTDeleteById") + aotOperationCount("operationAOTDeleteByVal") : 0;
const show = (o: object): string => JSON.stringify(o, (key, value) => typeof value === "bigint" ? "big" + value : value) + " " + Object.keys(o).join();
let read = 0;
for (const name of names) {
  let yes = 0;
  for (let i = 0; i < 40; i++) yes += removes[name]!(full(i)) ? 1 : 0;
  const before = entered();
  for (let i = 0; i < 2000; i++) { const o = full(i); yes += removes[name]!(o) ? 1 : 0; read += o.id + Object.keys(o).length + (name in o ? 100 : 0); }
  console.log(name, yes, read, entered() - before < 40);
}
for (const make of [full, reversed, some]) {
  for (const name of names) {
    const o = make(1);
    console.log(removes[name]!(o), show(o), name in o, Object.hasOwn(o, name), (o as any)[name]);
  }
  const all = make(2);
  for (const name of names) removes[name]!(all);
  console.log(show(all));
  const loose: any = all;
  loose.flag = true; loose.text = "again"; loose.count = 3;
  console.log(show(all), all.text, all.count, all.flag);
  for (const name of names) removeByKey(all, name);
  console.log(show(all), removes.text!(all), removes.text!(all));
  const twice = make(3), twiceLoose: any = twice;
  for (let i = 0; i < 4; i++) { removes.text!(twice); twiceLoose.text = "t" + i; removes.flag!(twice); twiceLoose.flag = i % 2 === 0; }
  console.log(show(twice));
}
for (let i = 0; i < 60; i++) { const n = new Node(i, "l"); removes.label!(n); if (i % 20 === 0) console.log(show(n), "label" in n, n.label); }
for (const lock of [Object.freeze, Object.seal, Object.preventExtensions]) {
  for (let i = 0; i < 3; i++) {
    const o = lock(full(i));
    let said: unknown;
    try { said = removes.text!(o); } catch (error) { said = (error as Error).name; }
    let saidByKey: unknown;
    try { saidByKey = removeByKey(o, "count"); } catch (error) { saidByKey = (error as Error).name; }
    console.log(lock.name, said, saidByKey, Object.keys(o).join());
  }
}
const marked = full(7), markedLoose: any = marked;
markedLoose.extra = 1;
console.log(removes.text!(marked), removes.inner!(marked), show(marked));
const inherits = full(8);
Object.setPrototypeOf(inherits, { text: "above" });
console.log(removes.text!(inherits), (inherits as any).text, Object.keys(inherits).join());
const typedRead = full(9);
removes.count!(typedRead); removes.inner!(typedRead); removes.big!(typedRead);
console.log(typedRead.count, typedRead.inner, typedRead.big, typedRead.whole, typedRead.count === undefined, { ...typedRead }.text);
