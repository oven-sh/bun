// Top-level constants that nothing reads. Those whose initializer calls something, reads a getter, converts an object or runs an iterator have an effect that shows in the log. `bun run` and `bun build --compile` print the same.
const log = [];
function effect(name) { log.push(name); return name; }
const source = { get getter() { return effect("a getter"); } };
const converts = { toString() { return effect("toString"); }, valueOf() { return effect("valueOf"); } };
const iterable = { *[Symbol.iterator]() { effect("an iterator"); } };

const number = 1 + 2;
const text = "a" + "b";
const literal = { a: 1, b: [2, 3] };
const arrow = () => effect("never called");
const call = effect("a call");
const construct = new (class { constructor() { effect("a constructor"); } })();
const member = source.getter;
const template = `${converts}`;
const sum = converts + 1;
const spreadArray = [...iterable];
const spreadObject = { ...source };
const tagged = effect`a tagged template`;
const conditional = log.length ? effect("an arm of a conditional") : 0;
const optional = source?.getter;
const inOperator = "x" in new Proxy({}, { has() { effect("a has trap"); return true; } });
const instance = {} instanceof class { static [Symbol.hasInstance]() { effect("hasInstance"); return true; } };
const awaited = await { then(resolve) { effect("then"); resolve(); } };

console.log(log.join("\n"));
