// One name of node:events is imported and used; another, getEventListeners, is found through the entries of a namespace import under a name that is put together at run time, and is used too.
import { once } from "node:events";
import * as space from "node:events";
const seen = [];
console.log("the name that is imported:", String(typeof once));
const key = ["getEvent", "Listeners"].join("");
const whole = Object.fromEntries(Object.entries(space));
const F = whole[key];
try {
  console.log("the other member:", String(F(new EventTarget(), "x").length));
} catch (error) {
  console.log("the other member threw " + error.constructor.name + ": " + error.message);
}
