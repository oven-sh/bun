// Ways to give `target[name]` a value that end in [[DefineOwnProperty]] on `target`, and not in its [[Set]]. A store
// through a proxy that only forwards is one since WebKit 23777f3b79, and the last four are definitions to begin with.
// The tests that require this file expect each of them to reach the native setter behind `target[name]`.
module.exports = {
  "a proxy": (target, name, value) => {
    new Proxy(target, {})[name] = value;
  },
  // The proxy remembers after the first store that its handler has no traps.
  "a proxy, the second time": (target, name, value) => {
    const proxy = new Proxy(target, {});
    proxy[name] = function storedFirst() {};
    proxy[name] = value;
  },
  "a proxy of a proxy": (target, name, value) => {
    new Proxy(new Proxy(target, {}), {})[name] = value;
  },
  "a revocable proxy": (target, name, value) => {
    Proxy.revocable(target, {}).proxy[name] = value;
  },
  "Reflect.set with a proxy as the receiver": (target, name, value) => {
    if (!Reflect.set(target, name, value, new Proxy(target, {}))) throw new Error("Reflect.set answered false");
  },
  "Reflect.set on another object with a proxy as the receiver": (target, name, value) => {
    if (!Reflect.set({}, name, value, new Proxy(target, {}))) throw new Error("Reflect.set answered false");
  },
  "Object.assign onto a proxy": (target, name, value) => {
    Object.assign(new Proxy(target, {}), { [name]: value });
  },
  "a set trap that hands the receiver on": (target, name, value) => {
    new Proxy(target, { set: (object, key, stored, receiver) => Reflect.set(object, key, stored, receiver) })[name] =
      value;
  },
  "a getOwnPropertyDescriptor trap that hands the answer on": (target, name, value) => {
    new Proxy(target, { getOwnPropertyDescriptor: (object, key) => Reflect.getOwnPropertyDescriptor(object, key) })[
      name
    ] = value;
  },
  "a defineProperty trap that hands the definition on": (target, name, value) => {
    let calls = 0;
    new Proxy(target, {
      defineProperty: (object, key, descriptor) => (calls++, Reflect.defineProperty(object, key, descriptor)),
    })[name] = value;
    if (calls !== 1) throw new Error("the defineProperty trap ran " + calls + " times");
  },
  "Object.defineProperty with a value": (target, name, value) => {
    Object.defineProperty(target, name, { value });
  },
  "Object.defineProperty that repeats the attributes": (target, name, value) => {
    Object.defineProperty(target, name, { ...Object.getOwnPropertyDescriptor(target, name), value });
  },
  // A class field defines its value on what the constructor of the base class returned, and says that the property is
  // writable, enumerable and configurable. That is a store of the value where `target[name]` is all three.
  "a class field on a returned object": (target, name, value) => {
    class Returns {
      constructor() {
        return target;
      }
    }
    new (class extends Returns {
      [name] = value;
    })();
  },
  // The same with the name written in the source text, which is another instruction.
  "a class field with a written name on a returned object": (target, name, value) => {
    if (!/^[A-Za-z_$][\w$]*$/.test(name)) throw new Error("not a name: " + name);
    new Function(
      "target",
      "value",
      `class Returns { constructor() { return target; } }
       new (class extends Returns { ${name} = value; })();`,
    )(target, value);
  },
};
