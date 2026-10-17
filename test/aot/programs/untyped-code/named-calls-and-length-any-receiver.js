// `o.method(..)` and `o.length` with a constant name, each site seeing many kinds of receivers, while methods are replaced, shadowed, deleted and turned into accessors.
const lines = [];
function say(label, value) {
  lines.push(label + ": " + (JSON.stringify(value) ?? String(value)));
}
function call0(o) { return o.describe(); }
function call1(o, a) { return o.describe(a); }
function call2(o, a, b) { return o.describe(a, b); }
function call3(o, a, b, c) { return o.describe(a, b, c); }
function call4(o, a, b, c, d) { return o.describe(a, b, c, d); }
function call6(o, a, b, c, d, e, f) { return o.describe(a, b, c, d, e, f); }
function lengthOf(o) { return o.length; }
function attempt(f, ...rest) {
  try {
    return f(...rest);
  } catch (error) {
    return error.constructor.name;
  }
}
function all(o) {
  return [attempt(call0, o), attempt(call1, o, 1), attempt(call2, o, 1, 2), attempt(call3, o, 1, 2, 3), attempt(call4, o, 1, 2, 3, 4), attempt(call6, o, 1, 2, 3, 4, 5, 6)];
}
function tell(...rest) { return (this === undefined ? "undefined" : this === null ? "null" : typeof this === "object" || typeof this === "function" ? (this.tag ?? typeof this) : typeof this + " " + String(this)) + "(" + rest.join() + ")"; }

// The method is the object's own, at every place.
for (let before = 0; before < 10; before++) {
  const o = { tag: "own" + before };
  for (let i = 0; i < before * 3; i++) o["pad" + i] = i;
  o.describe = tell;
  for (let round = 0; round < 2; round++) say("own " + before, all(o));
}

// The method is inherited, replaced, shadowed, deleted, an accessor, no function.
{
  class Base { tag = "instance"; describe(...rest) { return "Base." + tell.apply(this, rest); } }
  class Derived extends Base {}
  class Overrides extends Base { describe(...rest) { return "Overrides." + super.describe(...rest); } }
  const objects = [new Base(), new Derived(), new Overrides(), Object.create(new Derived())];
  for (let round = 0; round < 3; round++) say("classes", objects.map(all));
  Base.prototype.describe = function replaced(...rest) { return "replaced." + tell.apply(this, rest); };
  for (let round = 0; round < 2; round++) say("replaced", objects.map(all));
  objects[1].describe = tell;
  say("shadowed", objects.map(o => attempt(call1, o, 1)));
  delete objects[1].describe;
  say("no longer shadowed", objects.map(o => attempt(call1, o, 1)));
  let reads = 0;
  Object.defineProperty(Derived.prototype, "describe", { get() { reads++; return tell; }, configurable: true });
  for (let round = 0; round < 3; round++) say("accessor", [objects.map(o => attempt(call2, o, 1, 2)), reads]);
  Object.defineProperty(Derived.prototype, "describe", { value: 12, configurable: true, writable: true });
  say("a number", objects.map(o => attempt(call0, o)));
  delete Derived.prototype.describe;
  delete Base.prototype.describe;
  say("deleted", objects.map(o => attempt(call0, o)));
}

// Receivers that are not plain objects.
{
  const added = [Function.prototype, Array.prototype, String.prototype, Number.prototype, Boolean.prototype].map(() => 0);
  function named() {}
  named.describe = tell;
  named.tag = "function";
  const list = Object.assign([1, 2], { describe: tell, tag: "array" });
  const proxy = new Proxy({ tag: "target" }, { get(target, key) { return key === "describe" ? tell : target[key]; } });
  const bound = { tag: "bound holder", describe: tell.bind({ tag: "bound this" }) };
  const arrow = { tag: "arrow holder", describe: (...rest) => "arrow(" + rest.join() + ")" };
  const host = { tag: "host holder", describe: Math.max };
  const receivers = [named, list, proxy, bound, arrow, host, "text", 12, true, undefined, null, {}, Object.create(null), new Map(), Symbol("s")];
  for (let round = 0; round < 3; round++) say("receivers", receivers.map(o => [attempt(call0, o), attempt(call2, o, 3, 4)]));
  say("unused", added.length);
}

// length.
{
  function f(a, b) {}
  const withLength = [[], [1, 2, 3], new Array(7), "", "four", "a" + "b".repeat(3), new Uint8Array(5), new Float64Array(2), f, () => 1, { length: "own" }, { get length() { return "getter"; } }, Object.create({ length: "inherited" }), {}, new Map(), new String("boxed"), (function () { return arguments; })(1, 2), 12, true, Symbol("s"), new Proxy([1, 2], {}), class { static length = "static"; }];
  for (let round = 0; round < 3; round++) say("length", withLength.map(o => attempt(lengthOf, o)));
  say("length of nothing", [attempt(lengthOf, undefined), attempt(lengthOf, null)]);
  const growing = [];
  const seen = [];
  for (let i = 0; i < 5; i++) { seen.push(lengthOf(growing)); growing.push(i); }
  growing.length = 2;
  seen.push(lengthOf(growing));
  say("growing", seen);
}

console.log(lines.join("\n"));
