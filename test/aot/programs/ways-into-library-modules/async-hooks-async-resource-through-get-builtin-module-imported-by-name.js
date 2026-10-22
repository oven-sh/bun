// One name of node:async_hooks is imported and used; another, AsyncResource, is found through getBuiltinModule, imported from node:process by name under a name that is put together at run time, and is used too.
import { executionAsyncId } from "node:async_hooks";
import { getBuiltinModule } from "node:process";
const seen = [];
console.log("the name that is imported:", String(typeof executionAsyncId()));
const key = ["AsyncR", "esource"].join("");
const name = ["node:", "async_hooks"].join("");
const whole = getBuiltinModule(name);
const F = whole[key];
try {
  console.log("the other member:", String(new F("kind").runInAsyncScope(() => 5)));
} catch (error) {
  console.log("the other member threw " + error.constructor.name + ": " + error.message);
}
