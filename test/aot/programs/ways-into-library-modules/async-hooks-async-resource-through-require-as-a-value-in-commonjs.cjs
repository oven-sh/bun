// One name of node:async_hooks is imported and used; another, AsyncResource, is found through require, taken as a value in a CommonJS file under a name that is put together at run time, and is used too.
const { executionAsyncId } = require("node:async_hooks");
const seen = [];
console.log("the name that is imported:", String(typeof executionAsyncId()));
const key = ["AsyncR", "esource"].join("");
const name = ["node:", "async_hooks"].join("");
const load = require;
const whole = [name].map(load)[0];
const F = whole[key];
try {
  console.log("the other member:", String(new F("kind").runInAsyncScope(() => 5)));
} catch (error) {
  console.log("the other member threw " + error.constructor.name + ": " + error.message);
}
