// One name of node:async_hooks is imported and used; another, AsyncResource, is found through process.getBuiltinModule, the default of a parameter under a name that is put together at run time, and is used too.
import { executionAsyncId } from "node:async_hooks";
const seen = [];
console.log("the name that is imported:", String(typeof executionAsyncId()));
const key = ["AsyncR", "esource"].join("");
const name = ["node:", "async_hooks"].join("");
function take(load = process.getBuiltinModule) {
  return load(name);
}
const whole = take();
const F = whole[key];
try {
  console.log("the other member:", String(new F("kind").runInAsyncScope(() => 5)));
} catch (error) {
  console.log("the other member threw " + error.constructor.name + ": " + error.message);
}
