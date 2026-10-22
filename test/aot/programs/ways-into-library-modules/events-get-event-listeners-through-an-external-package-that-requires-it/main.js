// One name of node:events is imported and used; another, getEventListeners, is found through a package marked --external, which requires the module by the name it is handed, and is used too.
import { once } from "node:events";
import take from "outside";
const seen = [];
console.log("the name that is imported:", String(typeof once));
const key = ["getEvent", "Listeners"].join("");
const name = ["node:", "events"].join("");
const whole = take(name);
const F = whole[key];
try {
  console.log("the other member:", String(F(new EventTarget(), "x").length));
} catch (error) {
  console.log("the other member threw " + error.constructor.name + ": " + error.message);
}
