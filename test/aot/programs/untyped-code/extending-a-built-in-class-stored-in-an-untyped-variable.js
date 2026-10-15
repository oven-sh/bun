// Node's primordials as @pkgjs/parseargs carries them: the built-in classes are read off the global object by computed names, held by untyped variables of the same names, and extended.
const primordials = {};
for (const name of ["Map", "Set", "WeakMap", "WeakSet", "Promise"]) primordials[name] = globalThis[name];
const { Map, Set, WeakMap, WeakSet, Promise } = primordials;
const copyProps = (src, dest) => {
  for (const key of Reflect.ownKeys(src)) {
    if (!Reflect.getOwnPropertyDescriptor(dest, key)) Reflect.defineProperty(dest, key, Reflect.getOwnPropertyDescriptor(src, key));
  }
};
const makeSafe = (unsafe, safe) => {
  copyProps(unsafe.prototype, safe.prototype);
  copyProps(unsafe, safe);
  Object.setPrototypeOf(safe.prototype, null);
  Object.freeze(safe.prototype);
  Object.freeze(safe);
  return safe;
};
const SafeMap = makeSafe(Map, class SafeMap extends Map { constructor(i) { super(i); } });
const SafeSet = makeSafe(Set, class SafeSet extends Set { constructor(i) { super(i); } });
const SafeWeakMap = makeSafe(WeakMap, class SafeWeakMap extends WeakMap { constructor(i) { super(i); } });
const SafePromise = makeSafe(Promise, class SafePromise extends Promise { constructor(executor) { super(executor); } });
const byMember = class extends primordials.Set {};
const m = new SafeMap([[1, "one"]]); m.set(2, "two");
const s = new SafeSet([1, 2, 2]);
const key = {}; const w = new SafeWeakMap([[key, 1]]);
console.log(m.get(1), m.get(2), m.size, m instanceof globalThis.Map, Object.getPrototypeOf(SafeMap.prototype), Object.isFrozen(SafeMap));
console.log(s.has(2), s.size, [...globalThis.Set.prototype.values.call(s)].join(), w.get(key), new byMember([3]).has(3));
new SafePromise((resolve) => resolve(5)).then((v) => console.log("resolved", v));
const plain = new globalThis.Map([[1, 2]]); console.log(plain.get(1), plain.size, new globalThis.Set([1]).has(1));
