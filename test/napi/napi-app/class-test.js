const tests = require("./build/Debug/napitests.node");

const NapiClass = tests.get_class_with_constructor();

let instance = new NapiClass();
console.log("foo =", instance.foo);
console.log("data =", instance.getData(1, 2, 3, 4, 5, 6, 7, 8));
instance = undefined;
Bun.gc(true);
console.log("hello", Math.sqrt(3));
