// One name of node:events is imported and used; another, EventEmitter, is found through Module.prototype.require under a name that is put together at run time, and is used too.
import { once } from "node:events";
import Module from "node:module";
const seen = [];
console.log("the name that is imported:", String(typeof once));
const key = ["EventE", "mitter"].join("");
const name = ["node:", "events"].join("");
const whole = Module.prototype.require.call(new Module("x"), name);
const F = whole[key];
try {
  console.log("the other member:", String((emitter => (emitter.on("x", value => seen.push(value)), emitter.emit("x", 5), seen.join()))(new F())));
} catch (error) {
  console.log("the other member threw " + error.constructor.name + ": " + error.message);
}
