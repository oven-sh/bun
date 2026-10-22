// Plain objects are made with Object.create(typed) and then stored to. The store adds an own property unless something on the chain intercepts it: a setter or a read-only property. A typed object on the chain can only come to intercept through defineProperty, freeze or a change of its own prototype, and each of these forgets what was remembered. The store does not enter the runtime every time.
declare const aotOperationCount: undefined | ((name: string) => number);
interface Step { op: string; weight: number; args: unknown; note?: string }
function makeStep(op: string, weight: number): Step { return { op, weight, args: undefined }; }
const steps: Step[] = [];
for (let i = 0; i < 8; i++) steps.push(makeStep("s" + i, i + 0.5));
let typedSum = 0;
for (const step of steps) typedSum += step.weight + step.op.length;
console.log(typedSum);
const loose: any[] = (function (list: any): any { return list; })(steps);
const entered = (): number => typeof aotOperationCount === "function" ? aotOperationCount("operationAOTPutByIdAndCache") : 0;
const heirOf = function (base: any, v: any): any { const made = Object.create(base); made.value = v; made.args = v; made.op = "own"; return made; };
const show = function (o: any): string { return [Object.keys(o).join(), o.value, o.args, o.op, o.weight].join(" "); };
const attempt = function (base: any, v: any): string { try { return show(heirOf(base, v)); } catch (error: any) { return error.constructor.name; } };
console.log(attempt(loose[0], 1));
{
  let sum = 0;
  for (let i = 0; i < 50; i++) sum += heirOf(loose[0], i).value;
  const before = entered();
  for (let i = 0; i < 2000; i++) sum += heirOf(loose[0], i).value;
  console.log(sum, entered() - before < 40, steps[0]!.op, steps[0]!.args);
}
let log: string[] = [];
console.log("before:", attempt(loose[1], 2));
Object.defineProperty(loose[1], "value", { set(this: any, v: any) { log.push("setter on the prototype " + v + " " + (this !== loose[1])); }, get() { return "got"; }, configurable: true });
console.log("a setter on the typed prototype:", attempt(loose[1], 3), log.join()); log = [];
console.log("another prototype of the same type is not touched:", attempt(loose[0], 4));
console.log("before:", attempt(loose[2], 5));
Object.defineProperty(loose[2], "value", { value: "fixed", writable: false, configurable: true });
console.log("a read-only extra property:", attempt(loose[2], 6));
console.log("before:", attempt(loose[3], 7));
Object.freeze(loose[3]);
console.log("frozen:", attempt(loose[3], 8));
const onlyValue = function (base: any, v: any): string { try { const made = Object.create(base); made.value = v; return Object.keys(made).join() + " " + made.value; } catch (error: any) { return error.constructor.name; } };
console.log("frozen, a name it does not have:", onlyValue(loose[3], 9));
console.log("before:", attempt(loose[5], 13));
Object.defineProperty(loose[5], "args", { value: "fixed args", writable: false, enumerable: true, configurable: true });
console.log("a declared field made read-only:", attempt(loose[5], 14));
console.log("before:", attempt(loose[6], 15));
try {
  Object.setPrototypeOf(loose[6], { set value(v: any) { log.push("setter above the prototype " + v); }, get value() { return "above"; } });
  console.log("a new prototype above, with a setter:", attempt(loose[6], 16), log.join());
} catch (error: any) { console.log("a new prototype above, with a setter:", error.constructor.name); }
log = [];
loose[7].value = "data on the prototype";
console.log("plain data on the prototype does not intercept:", attempt(loose[7], 17), loose[7].value);
delete loose[7].value;
console.log("and deleted:", attempt(loose[7], 18));
