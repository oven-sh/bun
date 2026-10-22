// One name of node:async_hooks is imported and used; another, AsyncResource, is found through a package marked --external, an ES module that imports it by the name it is handed, and is used too.
import { executionAsyncId } from "node:async_hooks";
import take from "outside";
const seen = [];
console.log("the name that is imported:", String(typeof executionAsyncId()));
const key = ["AsyncR", "esource"].join("");
const name = ["node:", "async_hooks"].join("");
const whole = await take(name);
const F = whole[key];
try {
  console.log("the other member:", String(new F("kind").runInAsyncScope(() => 5)));
} catch (error) {
  console.log("the other member threw " + error.constructor.name + ": " + error.message);
}
