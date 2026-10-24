// One function of the module per scope that could catch its name: a catch parameter, a loop variable, a class name, a label, a property, a parameter of another function, a type parameter and an interface. Where the scope has ended, or the other thing is no variable, the name means the function of the module.
const log: string[] = [];
function afterCatch() { return "after catch"; } function afterLoop() { return "after loop"; } function besideLabel() { return "beside a label"; }
function besideProperty() { return "beside a property"; } function besideParameter() { return "beside a parameter"; } function T() { return "beside a type parameter"; }
function Shape() { return "beside an interface"; } function inInitializer() { return "in the initializer of the loop"; } function afterClass() { return "after a class expression"; }

try { throw 1; } catch (afterCatch) {}
log.push(afterCatch());
for (const afterLoop of [1]) {}
log.push(afterLoop());
besideLabel: for (;;) { log.push(besideLabel()); break besideLabel; }
log.push({ besideProperty: 1 }.besideProperty + " " + besideProperty());
function takes(besideParameter: number) { return besideParameter; }
log.push(takes(1) + " " + besideParameter());
function generic<T>(value: T): T { return value; }
log.push(generic(T()));
interface Shape { sides: number }
log.push(Shape());
for (const value of [inInitializer()]) { const inInitializer = value; log.push(inInitializer); }
const Expression = class afterClass {};
log.push(afterClass() + " " + Expression.name);
console.log(log.join("\n"));
