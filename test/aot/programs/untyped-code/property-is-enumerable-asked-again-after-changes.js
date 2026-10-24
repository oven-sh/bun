// Object.prototype.propertyIsEnumerable.call(object, key) asked over and over, with the object changed in between: an answer that is remembered may not outlive what it was about.
const said = [];
const isEnumerable = (object, key) => Object.prototype.propertyIsEnumerable.call(object, key);
const ask = (object, ...keys) => { let answers = ""; for (let round = 0; round < 3; round++) answers = keys.map(key => +isEnumerable(object, key)).join(""); return answers; };
const show = (label, ...answers) => said.push(label + ": " + answers.join(" "));
const make = () => ({ a: 1, b: 2, c: 3 });
{
  const o = make(), twin = make();
  const steps = [ask(o, "a", "b", "z")];
  Object.defineProperty(o, "a", { enumerable: false }); steps.push(ask(o, "a", "b", "z"), ask(twin, "a", "b", "z"));
  Object.defineProperty(o, "a", { enumerable: true }); steps.push(ask(o, "a", "b", "z"));
  delete o.b; steps.push(ask(o, "a", "b", "z"), ask(twin, "a", "b", "z"));
  o.b = "again"; steps.push(ask(o, "a", "b", "z"));
  o.z = 1; steps.push(ask(o, "a", "b", "z"), ask(twin, "a", "b", "z"));
  show("hidden, shown, deleted, added", ...steps);
}
{
  const o = make();
  const steps = [ask(o, "a", "b")];
  Object.defineProperty(o, "a", { get() { return 1; }, enumerable: true, configurable: true }); steps.push(ask(o, "a", "b"));
  Object.defineProperty(o, "a", { get() { return 1; }, enumerable: false }); steps.push(ask(o, "a", "b"));
  Object.defineProperty(o, "a", { value: 1, enumerable: true }); steps.push(ask(o, "a", "b"));
  Object.defineProperty(o, "b", { value: 2, writable: false }); steps.push(ask(o, "a", "b"));
  Object.defineProperty(o, "b", { enumerable: false, configurable: false }); steps.push(ask(o, "a", "b"));
  show("a value, an accessor, a value again", ...steps);
}
{
  const frozen = make(), sealed = make(), closed = make();
  const before = [ask(frozen, "a", "z"), ask(sealed, "a", "z"), ask(closed, "a", "z")];
  Object.freeze(frozen); Object.seal(sealed); Object.preventExtensions(closed);
  show("frozen, sealed, closed", ...before, ask(frozen, "a", "z"), ask(sealed, "a", "z"), ask(closed, "a", "z"));
}
{
  const parent = { inherited: 1 }, child = Object.create(parent);
  const steps = [ask(child, "inherited", "own")];
  child.own = 1; steps.push(ask(child, "inherited", "own"));
  child.inherited = 2; steps.push(ask(child, "inherited", "own"), ask(parent, "inherited", "own"));
  Object.setPrototypeOf(child, null); steps.push(ask(child, "inherited", "own"));
  show("what is inherited is not its own", ...steps);
}
{
  const many = {};
  for (let i = 0; i < 200; i++) many["k" + i] = i;
  const steps = [ask(many, "k0", "k100", "k199", "k200")];
  for (let i = 0; i < 200; i += 2) delete many["k" + i];
  steps.push(ask(many, "k0", "k100", "k199", "k1"));
  Object.defineProperty(many, "k1", { enumerable: false }); steps.push(ask(many, "k0", "k100", "k199", "k1"));
  many.k0 = "back"; steps.push(ask(many, "k0", "k100", "k199", "k1"));
  show("an object that was thinned out", ...steps);
}
{
  const o = { ab: 1, hidden: 2 };
  Object.defineProperty(o, "hidden", { enumerable: false });
  const built = ["a" + "b".repeat(1), ["a", "b"].join(""), "xab".slice(1), String.fromCharCode(97, 98), "hid" + "den", `${"hidd"}en`];
  show("keys that are put together at run time", ask(o, ...built), ask(o, ...built.map(key => key + "?")));
}
{
  class Point { constructor(x) { this.x = x; } get double() { return this.x * 2; } }
  const p = new Point(1), q = new Point(2);
  const steps = [ask(p, "x", "double", "y")];
  p.y = 1; steps.push(ask(p, "x", "double", "y"), ask(q, "x", "double", "y"));
  Object.defineProperty(q, "x", { enumerable: false }); steps.push(ask(p, "x", "double", "y"), ask(q, "x", "double", "y"));
  delete p.x; steps.push(ask(p, "x", "double", "y"));
  show("objects of a class", ...steps);
  const parsed = JSON.parse('{"a":1,"b":{"c":2}}'), other = JSON.parse('{"a":1,"b":{"c":2}}');
  Object.defineProperty(other, "a", { enumerable: false });
  show("objects that were parsed", ask(parsed, "a", "b", "c"), ask(parsed.b, "a", "b", "c"), ask(other, "a", "b", "c"));
}
{
  let count = 0;
  for (let i = 0; i < 30000; i++) {
    const o = { ["p" + (i % 7)]: 1, shared: 1 };
    if (i % 5 === 0) Object.defineProperty(o, "shared", { enumerable: false });
    if (i % 11 === 0) delete o.shared;
    count += isEnumerable(o, "shared") + 2 * isEnumerable(o, "p3") + 4 * isEnumerable(o, "p" + (i % 3));
  }
  show("many shapes in turn", count);
}
console.log(said.join("\n"));
