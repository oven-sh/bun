// Nothing reads the names these patterns bind. Taking a value apart has effects of its own: a default that calls something, a getter, an iterator and its return method, a computed key, a rest element over a proxy. `bun run` and `bun build --compile` print the same.
const log = [];
function effect(name) { log.push(name); return name; }
const source = { get getter() { return effect("a getter"); }, present: 1 };
const iterable = {
  [Symbol.iterator]() {
    effect("Symbol.iterator");
    return { next() { effect("next"); return { done: false, value: 1 }; }, return() { effect("return"); return {}; } };
  },
};
const proxy = new Proxy({ a: 1 }, { ownKeys(target) { effect("an ownKeys trap"); return Reflect.ownKeys(target); } });

const { missing = effect("a default that is taken") } = source;
const { present = effect("never") } = source;
const { getter } = source;
const [first] = iterable;
const { [effect("a computed key")]: computed } = source;
const { ...rest } = proxy;
const [inner = effect("a default in an array pattern")] = [];
const { nested: { deep = effect("a default in a nested pattern") } = {} } = source;
for (const { looped = effect("a default in a loop") } of [{}]);

console.log(log.join("\n"));
