// Nothing names these classes. What runs when a class is defined still runs: a static field, a static block, a computed key, the expression after extends, a decorator. A class with none of those leaves no trace. `bun run` and `bun build --compile` print the same.
const log: string[] = [];
function effect(name: string): any { log.push(name); return name; }
function base(): typeof Object { log.push("extends"); return Object; }
function decorate(value: Function, context: ClassDecoratorContext) { log.push("a decorator"); }

class Quiet { method() { return effect("never"); } field = effect("never"); }
class StaticField { static field = effect("a static field"); }
class StaticBlock { static { effect("a static block"); } }
class ComputedKey { [effect("a computed key")]() {} }
class Heritage extends base() {}
@decorate class Decorated {}
class StaticPrivate { static #hidden = effect("a private static field"); }
class StaticAccessor { static accessor auto = effect("a static accessor"); }
const Expression = class { static field = effect("a static field of a class expression"); };

console.log(log.join("\n"));
