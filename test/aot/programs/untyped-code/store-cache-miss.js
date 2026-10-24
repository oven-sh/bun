// The first store of a name to an object of a new shape follows the ordinary [[Set]] rules, whatever kind of property or prototype chain it meets.
let serial = 0;
function withNewShape(object) {
  object["unique" + serial++] = 1;
  return object;
}
function attempt(action) {
  try {
    return action();
  } catch (error) {
    return error.constructor.name;
  }
}
function storeValue(object, value) {
  object.value = value;
  return object.value;
}
function storeExtra(object, value) {
  object.extra = value;
  return object.extra;
}
const log = [];
function report(title, make, store) {
  const results = [];
  for (let round = 0; round < 3; round++) {
    const object = make();
    results.push(String(attempt(() => store(object, round))));
    results.push(String(attempt(() => store(object, round + 10))));
  }
  console.log(title + ": " + results.join(" ") + (log.length ? " | " + log.splice(0).join(" ") : ""));
}
report("replace, writable", () => withNewShape({ value: -1 }), storeValue);
report("replace, read-only", () => Object.defineProperty(withNewShape({}), "value", { value: -1, writable: false, configurable: true, enumerable: true }), storeValue);
report("replace, not enumerable", () => Object.defineProperty(withNewShape({}), "value", { value: -1, writable: true, configurable: true, enumerable: false }), (o, v) => storeValue(o, v) + ":" + Object.keys(o).includes("value"));
report("replace, frozen", () => Object.freeze(withNewShape({ value: -1 })), storeValue);
report("replace, sealed", () => Object.seal(withNewShape({ value: -1 })), storeValue);
report("replace, own setter", () => withNewShape({ set value(v) { log.push("set" + v); }, get value() { return "got"; } }), storeValue);
report("replace, own getter only", () => withNewShape({ get value() { return "got"; } }), storeValue);
report("add, plain", () => withNewShape({ value: -1 }), storeExtra);
report("add, null prototype", () => withNewShape(Object.create(null)), storeExtra);
report("add, not extensible", () => Object.preventExtensions(withNewShape({ value: -1 })), storeExtra);
report("add, sealed", () => Object.seal(withNewShape({ value: -1 })), storeExtra);
report("add, inherited setter", () => withNewShape(Object.create({ set extra(v) { log.push("set" + v); }, get extra() { return "got"; } })), storeExtra);
report("add, inherited getter only", () => withNewShape(Object.create({ get extra() { return "got"; } })), storeExtra);
report("add, inherited read-only", () => withNewShape(Object.create(Object.freeze({ extra: "fixed" }))), storeExtra);
report("add, inherited writable", () => withNewShape(Object.create({ extra: "inherited" })), (o, v) => storeExtra(o, v) + ":" + Object.hasOwn(o, "extra"));
report("add, proxy on the chain", () => withNewShape(Object.create(new Proxy({}, { set(target, key, v, receiver) { log.push("trap:" + String(key) + v); return Reflect.set(target, key, v, receiver); } }))), storeExtra);
report("add, many properties", () => { const o = withNewShape({}); for (let i = 0; i < 40; i++) o["p" + i] = i; return o; }, (o, v) => storeExtra(o, v) + ":" + Object.keys(o).length);
report("add to a prototype object", () => { const parent = withNewShape({}); const child = Object.create(parent); child.probe = child.extra; return { parent, child }; }, (pair, v) => { const before = pair.child.extra; pair.parent.extra = v; return before + ">" + pair.child.extra; });
report("replace on a prototype object", () => { const parent = withNewShape({ extra: "first" }); const child = Object.create(parent); return { parent, child }; }, (pair, v) => { const before = pair.child.extra; pair.parent.extra = v; return before + ">" + pair.child.extra; });
report("a setter appears on the chain later", () => { const parent = {}; return { parent, make: () => withNewShape(Object.create(parent)) }; }, (state, v) => {
  const first = storeExtra(state.make(), v);
  Object.defineProperty(state.parent, "extra", { set(x) { log.push("late" + x); }, get() { return "late"; }, configurable: true });
  const second = storeExtra(state.make(), v);
  delete state.parent.extra;
  return first + ">" + second + ">" + storeExtra(state.make(), v);
});
report("__proto__ by name", () => withNewShape({ value: -1 }), (o, v) => { o.__proto__ = { inherited: v }; return o.inherited + ":" + Object.hasOwn(o, "__proto__"); });
report("order of keys", () => withNewShape({ value: -1 }), (o, v) => { o.extra = v; o.value = v; o.last = v; return Object.keys(o).filter(k => !k.startsWith("unique")).join(","); });
