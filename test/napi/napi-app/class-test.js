const tests = require("./build/Debug/napitests.node");

const NapiClass = tests.get_class_with_constructor();

console.group("\nnew NapiClass()");
let instance = new NapiClass();
console.log("static data =", NapiClass.getStaticData());
console.log("static getter =", NapiClass.getter);
console.log("foo =", instance.foo);
console.log("data =", instance.getData());
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