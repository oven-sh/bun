// A typed object is used as the prototype of plain objects: Object.create(typed). Untyped code then reads through the chain. The plain heir's entry in the by-name table says only "not mine: ask my prototype", and the stub looks the name up again in the prototype's own row, so whatever happens to the prototype later is seen. It does not enter the runtime every time.
declare const aotOperationCount: undefined | ((name: string) => number);
interface Step { op: string; weight: number; whole: number; on: boolean; inner: { a: number }; nothing: null; either: string | undefined; run(this: any, x: number): number; note?: string; flag?: boolean; size?: number }
function makeStep(op: string, weight: number): Step {
  return { op, weight, whole: 7, on: true, inner: { a: weight }, nothing: null, either: undefined, run(this: any, x: number): number { return x + this.weight; } };
}
const steps: Step[] = [makeStep("add", 1.5), makeStep("sub", 2.5)];
let typedSum = 0;
for (const step of steps) typedSum += step.weight + step.whole + step.op.length + step.inner.a + step.run(1) + (step.on ? 1 : 0);
console.log(typedSum);
const entered = (): number => typeof aotOperationCount === "function" ? aotOperationCount("operationAOTGetByIdAndCache") : 0;
const reads: Record<string, (o: any) => any> = {
  op: function (o: any): any { return o.op; }, weight: function (o: any): any { return o.weight; }, whole: function (o: any): any { return o.whole; }, on: function (o: any): any { return o.on; },
  inner: function (o: any): any { return o.inner; }, nothing: function (o: any): any { return o.nothing; }, either: function (o: any): any { return o.either; }, note: function (o: any): any { return o.note; },
  flag: function (o: any): any { return o.flag; }, size: function (o: any): any { return o.size; }, missing: function (o: any): any { return o.missing; }, later: function (o: any): any { return o.later; },
  asText: function (o: any): any { return o.toString; }, value: function (o: any): any { return o.value; }, who: function (o: any): any { return o.who; },
};
const show = (v: any): string => typeof v === "function" ? "function " + v.name : typeof v === "object" && v !== null ? JSON.stringify(v) : String(v);
const base: any = steps[0]!;
const heir: any = Object.create(base);
heir.value = 1;
const other: any = Object.create(steps[1]!);
other.value = 2;
const all = (o: any): string => Object.keys(reads).map(name => name + "=" + show(reads[name]!(o))).join(" ");
console.log(all(heir));
console.log(all(other));
for (const name of ["op", "weight", "whole", "on", "inner", "nothing", "either", "missing", "asText", "value"]) {
  let same = 0;
  const first = reads[name]!(heir);
  const before = entered();
  for (let i = 0; i < 2000; i++) same += reads[name]!(heir) === first ? 1 : 0;
  console.log(name, same, entered() - before < 20);
}
let called = 0;
for (let i = 0; i < 100; i++) called += heir.run(i) + other.run(i);
console.log(called);

steps[0]!.op = "mul"; steps[0]!.weight = 4.25; steps[0]!.whole = -3; steps[0]!.on = false; steps[0]!.inner = { a: 9 }; steps[0]!.either = "now";
console.log("typed stores:", all(heir));
steps[0]!.note = "noted"; steps[0]!.flag = false; steps[0]!.size = 12;
console.log("optional fields stored:", all(heir));
delete base.note; delete base.flag;
console.log("optional fields deleted:", all(heir));
base.later = "extra";
console.log("an extra property on the prototype:", all(heir), "|", reads.later!(other));
delete base.later;
console.log("and deleted:", reads.later!(heir));
Object.defineProperty(base, "mine", { get(this: any) { return this === heir ? "mine of the heir" : "mine of somebody"; }, configurable: true });
const readMine = function (o: any): any { return o.mine; };
console.log("a getter on the prototype itself:", readMine(heir), "|", readMine(base), "|", readMine(other));

heir.op = "own";
console.log("shadowed:", reads.op!(heir), reads.op!(base), steps[0]!.op);
delete heir.op;
console.log("no longer shadowed:", reads.op!(heir));
const grandchild: any = Object.create(heir);
console.log("two levels:", all(grandchild));
steps[0]!.op = "div";
console.log("two levels, after a typed store:", reads.op!(grandchild), reads.op!(heir));
Object.setPrototypeOf(heir, steps[1]!);
console.log("another prototype:", all(heir));
console.log("and below it:", reads.op!(grandchild), reads.weight!(grandchild));
Object.setPrototypeOf(heir, null);
console.log("none:", reads.op!(heir), reads.value!(heir), reads.asText!(heir));

const third: any = makeStep("third", 3.5);
const belowThird: any = Object.create(third);
console.log("before the prototype gets a prototype:", reads.who!(belowThird), reads.missing!(belowThird), reads.note!(belowThird), reads.op!(belowThird));
Object.setPrototypeOf(third, {
  missing: "from above",
  get who(): string { return this === belowThird ? "the heir" : this === third ? "the prototype" : "somebody"; },
  get note(): string { return this === belowThird ? "note of the heir" : "note of somebody"; },
});
console.log("after:", reads.who!(belowThird), "|", reads.who!(third), "|", reads.missing!(belowThird), "|", reads.note!(belowThird), "|", reads.op!(belowThird), reads.weight!(belowThird));
Object.defineProperty(third, "note", { value: "own note", writable: true, enumerable: true, configurable: true });
console.log("the optional field is stored:", reads.note!(belowThird));
delete third.note;
console.log("and deleted:", reads.note!(belowThird));

class Shape { sides: number; label: string; constructor(sides: number, label: string) { this.sides = sides; this.label = label; } get twice(): number { return this.sides * 2; } describe(): string { return this.label + ":" + this.sides; } }
const shapes: Shape[] = [new Shape(3, "triangle"), new Shape(4, "square")];
const belowInstance: any = Object.create(shapes[0]!);
const readShape = function (o: any): any { return [o.sides, o.label, o.twice, o.describe()].join(); };
for (let i = 0; i < 3; i++) console.log("below a class instance:", readShape(belowInstance));
belowInstance.sides = 10;
console.log("with its own sides:", readShape(belowInstance), readShape(shapes[0]!));
