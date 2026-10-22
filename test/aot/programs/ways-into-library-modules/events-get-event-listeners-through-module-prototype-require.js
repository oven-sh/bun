// One name of node:events is imported and used; another, getEventListeners, is found through Module.prototype.require under a name that is put together at run time, and is used too.
import { once } from "node:events";
import Module from "node:module";
const seen = [];
console.log("the name that is imported:", String(typeof once));
const key = ["getEvent", "Listeners"].join("");
const name = ["node:", "events"].join("");
const whole = Module.prototype.require.call(new Module("x"), name);
const F = whole[key];
try {
  console.log("the other member:", String(F(new EventTarget(), "x").length));
} catch (error) {
  console.log("the other member threw " + error.constructor.name + ": " + error.message);
}
