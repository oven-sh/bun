// Every read, store and method call by name in a program's own code remembers at its own place where it found the property last time. Each case runs one place many times with one shape, then changes what the next run must see. Accessors are defined under names that come from data, so that the build cannot know of them.
const collect = typeof gc === "function" ? gc : typeof Bun !== "undefined" ? () => Bun.gc(true) : () => {};
const lines = [];
const warm = 40;
const [X, Y, Z, M, NAME] = JSON.parse('["x","y","z","m","name"]');
const say = (title, value) => lines.push(title + ": " + value);
const attempt = f => {
  try {
    return String(f());
  } catch (error) {
    return error.constructor.name;
  }
};

function readX(o) { return o.x; }
function readY(o) { return o.y; }
function storeX(o, v) { o.x = v; }
function addZ(o, v) { o.z = v; return o; }
function callM(o, a) { return o.m(a); }
function readLength(o) { return o.length; }
function readName(o) { return o.name; }

{
  const make = () => ({ w: 0, x: 1, y: 2 });
  const o = make();
  for (let i = 0; i < warm; i++) readX(o);
  say("own", readX(o));
  say("another order", readX({ x: 7, w: 0 }));
  say("the first again", readX(o));
  delete o.w;
  say("one deleted ahead of it", readX(o) + " " + readY(o));
  delete o.x;
  say("deleted", readX(o));
  o.x = 9;
  say("added again", readX(o));
  let reads = 0;
  Object.defineProperty(o, Y, { configurable: true, get() { return ++reads; } });
  say("another became an accessor", readX(o) + " " + readY(o) + " " + readY(o));
  Object.freeze(o);
  say("frozen", readX(o));
}

{
  const parent = { x: "parent" };
  const child = Object.create(parent);
  child.own = 1;
  for (let i = 0; i < warm; i++) readX(child);
  say("inherited", readX(child));
  parent.x = "changed";
  say("changed on the prototype", readX(child));
  parent.before = 1;
  say("the prototype grew", readX(child));
  delete parent.x;
  say("deleted on the prototype", readX(child));
  for (let i = 0; i < warm; i++) readX(child);
  say("absent", readX(child));
  parent.x = "back";
  say("no longer absent", readX(child));
  delete parent.x;
  say("what has none", [readX(child), readX({}), readX(5), readX("s"), readX(true), readX(Symbol.iterator), readX(10n), attempt(() => readX(null)), attempt(() => readX(undefined))].join(" "));
  child.x = "own now";
  say("shadowed", readX(child));
  delete child.x;
  Object.setPrototypeOf(child, { x: "another prototype" });
  say("another prototype", readX(child));
  Object.setPrototypeOf(child, null);
  say("no prototype", readX(child));
}

{
  const grand = { x: 1 };
  const parent = Object.create(grand);
  const child = Object.create(parent);
  for (let i = 0; i < warm; i++) readX(child);
  parent.x = 2;
  say("shadowed half way", readX(child));
  delete parent.x;
  say("unshadowed", readX(child));
  Object.setPrototypeOf(parent, { x: 3 });
  say("the chain was cut half way", readX(child));
}

{
  const o = { x: 0 };
  for (let i = 0; i < warm; i++) storeX(o, i);
  say("stored", o.x);
  Object.defineProperty(o, X, { writable: false });
  say("read-only", attempt(() => storeX(o, "no")) + " " + o.x);
  const p = { x: 0 };
  for (let i = 0; i < warm; i++) storeX(p, i);
  let given;
  Object.defineProperty(p, X, { configurable: true, set(v) { given = v; }, get() { return "got"; } });
  storeX(p, "to the setter");
  say("a setter", given + " " + p.x);
  const q = { x: 0 };
  for (let i = 0; i < warm; i++) storeX(q, i);
  Object.freeze(q);
  say("frozen", attempt(() => storeX(q, "no")) + " " + q.x);
}

{
  const parent = {};
  const make = () => { const o = Object.create(parent); o.a = 1; return o; };
  for (let i = 0; i < warm; i++) addZ(make(), i);
  say("added", JSON.stringify(addZ(make(), 5)));
  let given = "nothing";
  Object.defineProperty(parent, Z, { configurable: true, set(v) { given = v; } });
  say("a setter appeared on the prototype", JSON.stringify(addZ(make(), 6)) + " " + given);
  Object.defineProperty(parent, Z, { configurable: true, writable: false, value: "fixed" });
  say("read-only on the prototype", attempt(() => addZ(make(), 7)) + " " + make().z);
  delete parent.z;
  say("free again", JSON.stringify(addZ(make(), 9)));
  const closed = Object.preventExtensions(make());
  say("not extensible", attempt(() => addZ(closed, 1)) + " " + JSON.stringify(closed));
  for (let i = 0; i < warm; i++) addZ(make(), i);
  Object.setPrototypeOf(parent, Object.defineProperty({}, Z, { set(v) { given = "far " + v; } }));
  say("a setter farther up", JSON.stringify(addZ(make(), 2)) + " " + given);
}

{
  class Base { m(a) { return "base " + a; } }
  class Derived extends Base {}
  const o = new Derived();
  for (let i = 0; i < warm; i++) callM(o, i);
  say("a method", callM(o, 1));
  Derived.prototype.m = function (a) { return "derived " + a; };
  say("overridden", callM(o, 2));
  o.m = a => "own " + a;
  say("on the object", callM(o, 3));
  delete o.m;
  delete Derived.prototype.m;
  say("inherited again", callM(o, 4));
  Base.prototype.m = 5;
  say("not a function", attempt(() => callM(o, 5)));
  delete Base.prototype.m;
  say("absent", attempt(() => callM(o, 6)));
  Object.defineProperty(Base.prototype, M, { configurable: true, get() { return a => "from a getter " + a + " " + (this === o); } });
  say("a getter", callM(o, 7));
  say("of null", attempt(() => callM(null, 8)));
  say("of undefined", attempt(() => callM(undefined, 8)));
  say("of a number", attempt(() => callM(4, 5)));
  say("of a string", attempt(() => callM("s", 5)));
}

{
  for (let i = 0; i < warm; i++) readLength([1, 2, 3]);
  say("lengths", [readLength([1, 2]), readLength("four"), readLength(function (a, b, c) {}), readLength(new Uint8Array(6)), readLength({ length: "own" }), readLength({}), readLength(7)].join(" "));
  const grows = [];
  for (let i = 0; i < 5; i++) { grows.push(i); lines.push("grows: " + readLength(grows)); }
  function named() {}
  for (let i = 0; i < warm; i++) readName(named);
  say("names", [readName(named), readName(class Klass {}), readName(() => {}), readName(new Error("e")), readName(Symbol), readName({ name: 1 })].join(" "));
  Object.defineProperty(named, NAME, { value: "renamed" });
  say("renamed", readName(named));
}

{
  const seen = [];
  const proxy = new Proxy({ x: "target" }, {
    get(target, key, receiver) { seen.push("get " + String(key)); return Reflect.get(target, key, receiver); },
    set(target, key, value, receiver) { seen.push("set " + String(key)); return Reflect.set(target, key, value, receiver); },
  });
  for (let i = 0; i < 3; i++) readX(proxy);
  storeX(proxy, "stored");
  say("a proxy", readX(proxy) + " " + seen.join(","));
  const behind = Object.create(proxy);
  say("a proxy as prototype", readX(behind) + " " + seen.length);
}

{
  const many = {};
  for (let i = 0; i < 200; i++) many["k" + i] = i;
  many.x = "in a dictionary";
  for (let i = 0; i < 150; i++) delete many["k" + i];
  for (let i = 0; i < warm; i++) readX(many);
  say("a dictionary", readX(many));
  delete many.x;
  say("deleted from it", readX(many));
  many.x = "again";
  say("added to it", readX(many));
  storeX(many, "stored");
  say("stored to it", many.x);
}

{
  let sum = 0;
  for (let round = 0; round < 60; round++) {
    const o = {};
    o["only" + round] = round;
    if (round % 3) o.pad = 0;
    o.x = round;
    o.m = round % 2 ? a => a + round : function (a) { return this.x * a; };
    for (let i = 0; i < 4; i++) sum += readX(o) + callM(o, 2);
    storeX(o, round + 1);
    sum += o.x;
    if (round % 5 === 4) collect();
  }
  say("shapes that die between collections", sum);
}

{
  const shapes = [];
  for (let i = 0; i < 24; i++) { const o = {}; for (let k = 0; k < i; k++) o["f" + k] = k; o.x = i; shapes.push(o); }
  let sum = 0;
  for (let round = 0; round < 10; round++) for (const o of shapes) sum += readX(o);
  say("twenty-four shapes in turn", sum);
}

console.log(lines.join("\n"));
