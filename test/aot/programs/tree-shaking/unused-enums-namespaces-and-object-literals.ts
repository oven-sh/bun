// Nothing reads these. An enum member or a namespace statement that calls something has an effect; so have a computed key, a spread of an object with a getter and a method call in an object literal. A getter that is only defined has none. `bun run` and `bun build --compile` print the same.
const log: string[] = [];
function effect(name: string): any { log.push(name); return name.length; }
const withGetter = { get value() { return effect("a getter read by a spread"); } };

enum Plain { A, B }
enum Computed { A = effect("an enum member") }
const enum Erased { A = 1 }
namespace Empty { export interface OnlyTypes {} }
namespace Calls { effect("a statement of a namespace"); }
namespace Exports { export const value = effect("an exported constant of a namespace"); }

const definesGetter = { get value() { return effect("never"); } };
const definesMethod = { method() { return effect("never"); } };
const computedKey = { [effect("a computed key")]: 1 };
const spread = { ...withGetter };
const callInside = { value: effect("a call inside a literal") };
const nested = { inner: { list: [effect("a call inside a nested array")] } };

console.log(log.join("\n"));
