// One name of node:async_hooks is imported and used; another, AsyncLocalStorage, is found through a package marked --external, which asks process.getBuiltinModule for it, and is used too.
import { executionAsyncId } from "node:async_hooks";
import take from "outside";
const seen = [];
console.log("the name that is imported:", String(typeof executionAsyncId()));
const key = ["AsyncLoc", "alStorage"].join("");
const name = ["node:", "async_hooks"].join("");
const whole = take(name);
const F = whole[key];
try {
  console.log("the other member:", String((storage => storage.run(5, () => storage.getStore()))(new F())));
} catch (error) {
  console.log("the other member threw " + error.constructor.name + ": " + error.message);
}
