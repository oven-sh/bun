// What the compiler makes of `new` of a function that is cast to a type with a construct signature and captured by the function that calls it. Held by a constant, the function is expected and its body is inlined behind a test; held by a variable that changes, nothing is expected.
// IR= 1 ofAConstant CreateThis
// IR= 0 ofAVariable CreateThis
declare const console: { log(...values: unknown[]): void };
interface Held { held: unknown }
interface HeldClass { new (value: unknown): Held; prototype: object }
const constant = (kind: string): ((value: unknown) => Held) => {
  const Impl = function (this: any, value: unknown) { this.held = value } as unknown as HeldClass;
  Impl.prototype = { kind };
  return function ofAConstant(value: unknown) { return new Impl(value) };
};
const variable = (kind: string): [(value: unknown) => Held, () => void] => {
  let changing = function (this: any, value: unknown) { this.held = value } as unknown as HeldClass;
  changing.prototype = { kind };
  return [function ofAVariable(value: unknown) { return new changing(value) }, () => { changing = function (this: any, value: unknown) { this.held = [value] } as unknown as HeldClass }];
};
const ofAConstant = constant("held"), [ofAVariable, change] = variable("held");
console.log(ofAConstant(1).held, ofAVariable(2).held);
change();
console.log(ofAConstant(3).held, JSON.stringify(ofAVariable(4).held));
