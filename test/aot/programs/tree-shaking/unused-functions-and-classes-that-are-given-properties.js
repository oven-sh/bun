// Nothing calls these functions or constructs these classes, yet statements at the top level store into them, define properties on them and pass them on. The right-hand sides and the calls run. `bun run` and `bun build --compile` print the same.
const log = [];
function effect(name) { log.push(name); return name; }

function plain() {}
plain.label = effect("a property of a function");
plain.prototype.method = effect("a property of a prototype");
Object.defineProperty(plain, "defined", { value: effect("a defined property") });
Object.assign(plain, { assigned: effect("an assigned property") });

const arrow = () => {};
arrow.displayName = effect("a property of an arrow function");

class Klass {}
Klass.label = effect("a property of a class");
Klass.prototype.extra = effect("a property of a class's prototype");
Object.freeze(Klass);
log.push("frozen: " + Object.isFrozen(Klass));

function registered() {}
const registry = new Set();
registry.add(registered);
log.push("registered: " + registry.size);

function withSetter() {}
Object.defineProperty(withSetter, "watched", { set(value) { effect("a setter got " + value); } });
withSetter.watched = "x";

console.log(log.join("\n"));
