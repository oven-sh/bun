// What goes in through a bound built-in comes out again, and callbacks are called.
const assign = Object.assign.bind(Object);
const target = { a: 1 };
const made = assign(target, { b: { deep: 2 } }, { c: () => "called" });
console.log(made === target, target.b.deep, target.c());
const from = Array.from.bind(Array);
console.log(from({ length: 2 }, (_, index) => ({ index })).map((entry) => entry.index).join());
const entries = Object.entries.bind(Object);
for (const [key, value] of entries({ x: { y: 1 } })) console.log(key, value.y);
const apply = Reflect.apply.bind(Reflect);
console.log(apply(function (a) { return this.t + a; }, { t: 1 }, [2]));
const then = Promise.prototype.then.bind(Promise.resolve({ v: 3 }));
then((result) => console.log(result.v));
