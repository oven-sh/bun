// One name of node:events is imported and used; another, EventEmitter, is found through a module of the program that exports its namespace under a name that is put together at run time, and is used too.
import { once } from "node:events";
import { whole } from "./all.js";
const seen = [];
console.log("the name that is imported:", String(typeof once));
const key = ["EventE", "mitter"].join("");
const F = whole[key];
try {
  console.log("the other member:", String((emitter => (emitter.on("x", value => seen.push(value)), emitter.emit("x", 5), seen.join()))(new F())));
} catch (error) {
  console.log("the other member threw " + error.constructor.name + ": " + error.message);
}
