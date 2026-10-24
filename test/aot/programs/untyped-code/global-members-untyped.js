// A member of what a global holds (`settings.level`, `process.env`) is read behind a watch where the read is hot: what is read is always what is there now, however the member or the global is changed.
const world = globalThis;

world.settings = { level: 1, nested: { a: 1 }, name: "first" };
function level(rounds) {
  let sum = 0;
  for (let i = 0; i < rounds; i++) sum += settings.level;
  return sum;
}
function nested(rounds) {
  let sum = 0;
  for (let i = 0; i < rounds; i++) sum += settings.nested.a;
  return sum;
}
function later(rounds) {
  let seen = "";
  for (let i = 0; i < rounds; i++) seen = String(settings.later);
  return seen;
}
function described(rounds) {
  let seen = "";
  for (let i = 0; i < rounds; i++) seen = typeof settings.toString + " " + String(settings.name);
  return seen;
}
function raised(rounds) {
  for (let i = 0; i < rounds; i++) settings.level = settings.level + 1;
  return settings.level;
}
console.log("warm", level(5000), nested(5000), later(5000), described(5000));
settings.level = 2;
console.log("stored", level(10), settings.level);
settings.nested = { a: 5 };
console.log("another object", nested(10));
settings.nested.a = 6;
console.log("inside it", nested(10));
settings.later = "now";
console.log("added", later(10));
console.log("raised", raised(1000), level(2));
delete settings.level;
console.log("deleted", level(2), "level" in settings);
settings.level = 7;
console.log("there again", level(2));
let asked = 0;
Object.defineProperty(settings, "level", { get: () => ++asked, configurable: true });
console.log("a getter", level(3), asked);
Object.defineProperty(settings, "level", { value: 9, writable: true, configurable: true });
console.log("a value again", level(3));
settings.toString = () => "own";
console.log("shadowed", described(2), String(settings));
const first = settings;
world.settings = { level: 100, nested: { a: 200 }, name: "second" };
console.log("another global", level(2), nested(2), later(2), described(2));
first.level = -1;
console.log("the first is stored to", level(2));
world.settings = first;
console.log("the first again", level(2), nested(2));
delete world.settings;
try {
  console.log(level(1));
} catch (error) {
  console.log("no global", error.name);
}
world.settings = { level: 3, nested: { a: 4 } };
console.log("made anew", level(2), nested(2));
Object.defineProperty(world, "settings", { get: () => ({ level: ++asked, nested: { a: asked } }), configurable: true });
console.log("the global is a getter", level(3), nested(2));
delete world.settings;

let traps = 0;
world.proxied = new Proxy({ a: 1 }, { get: (target, key) => (traps++, target[key]) });
function throughProxy(rounds) {
  let sum = 0;
  for (let i = 0; i < rounds; i++) sum += proxied.a;
  return sum;
}
console.log("a proxy", throughProxy(3000), traps);

let made = 0;
Object.defineProperty(world, "dynamic", { get: () => ({ v: ++made }), configurable: true });
function ofGetter(rounds) {
  let sum = 0;
  for (let i = 0; i < rounds; i++) sum += dynamic.v;
  return sum;
}
console.log("a global that is a getter", ofGetter(3000), made);

world.count = 5;
world.text = "abc";
world.nothing = undefined;
function ofPrimitives(rounds) {
  let seen = "";
  for (let i = 0; i < rounds; i++) seen = typeof count.toFixed + " " + text.length + " " + typeof text.slice;
  return seen;
}
console.log("primitives", ofPrimitives(3000));
function ofNothing(rounds) {
  let seen = "";
  for (let i = 0; i < rounds; i++) {
    try {
      seen = String(nothing.x);
    } catch (error) {
      seen = error.name;
    }
  }
  return seen;
}
console.log("undefined", ofNothing(300));
world.nothing = { x: "something" };
console.log("an object now", ofNothing(3));

world.sealed = Object.freeze({ a: 1, b: Object.freeze({ c: 2 }) });
function ofFrozen(rounds) {
  let sum = 0;
  for (let i = 0; i < rounds; i++) sum += sealed.a + sealed.b.c;
  return sum;
}
console.log("frozen", ofFrozen(3000));

const ancestor = { inherited: 1 };
world.heir = Object.create(ancestor);
function ofHeir(rounds) {
  let sum = 0;
  for (let i = 0; i < rounds; i++) sum += heir.inherited;
  return sum;
}
console.log("inherited", ofHeir(3000));
ancestor.inherited = 2;
console.log("the parent is stored to", ofHeir(3));
heir.inherited = 3;
console.log("an own one", ofHeir(3));
Object.setPrototypeOf(heir, { inherited: 50, other: 1 });
delete heir.inherited;
console.log("another parent", ofHeir(3));

world.settings = { level: 1 };
function manyObjects(rounds) {
  let sum = 0;
  for (let i = 0; i < rounds; i++) {
    if ((i & 1023) === 0) world.settings = { level: i >> 10 };
    sum += settings.level;
  }
  return sum;
}
console.log("replaced again and again", manyObjects(10000));
export {};
