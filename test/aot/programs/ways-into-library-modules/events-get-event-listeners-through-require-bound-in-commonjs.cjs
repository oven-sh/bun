// One name of node:events is imported and used; another, getEventListeners, is found through require, bound, in a CommonJS file under a name that is put together at run time, and is used too.
const { once } = require("node:events");
const seen = [];
console.log("the name that is imported:", String(typeof once));
const key = ["getEvent", "Listeners"].join("");
const name = ["node:", "events"].join("");
const whole = require.bind(null)(name);
const F = whole[key];
try {
  console.log("the other member:", String(F(new EventTarget(), "x").length));
} catch (error) {
  console.log("the other member threw " + error.constructor.name + ": " + error.message);
}
