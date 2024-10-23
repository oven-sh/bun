const tests = require("./build/Debug/napitests.node");

tests.eval_wrapper(globalThis, global);

const NapiClass = tests.get_class_with_constructor();

console.group("\nnew NapiClass()");
let instance = new NapiClass();
console.log("foo =", instance.foo);
console.log("data =", instance.getData(1, 2, 3, 4, 5, 6, 7, 8));
console.groupEnd();

class Subclass extends NapiClass {}

console.group("\nnew (Subclass extends NapiClass)()");
instance = new Subclass();
console.log("subclass foo =", instance.foo);
console.log("subclass data =", instance.getData());
console.groupEnd();

console.group("\nNapiClass()");
console.log("non-constructor call NapiClass() =", NapiClass());
console.log("global foo set to ", typeof foo != "undefined" ? foo : undefined);
console.groupEnd();

delete globalThis.foo;

console.group("\nReflect.construct(NapiClass, [], Object)");
instance = Reflect.construct(NapiClass, [], NapiClass);
console.log("constructor called on new object foo =", instance.foo);
try {
  console.log("constructor called on new object data =", instance.getData);
} catch (e) {
  console.log("NapiClass.prototype.getData on wrong object threw", e.name);
}
