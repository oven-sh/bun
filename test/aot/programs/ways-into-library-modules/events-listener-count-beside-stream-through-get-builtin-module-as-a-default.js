// One name of node:events is imported and used, and so is node:stream, which reads node:events by names of its own; another, listenerCount, is found through process.getBuiltinModule, the default of a parameter under a name that is put together at run time, and is used too.
import { once } from "node:events";
import { PassThrough } from "node:stream";
const seen = [];
console.log("the name that is imported:", String(typeof once));
console.log("the other library module:", String(new PassThrough().readable));
const key = ["listen", "erCount"].join("");
const name = ["node:", "events"].join("");
function take(load = process.getBuiltinModule) {
  return load(name);
}
const whole = take();
const F = whole[key];
try {
  console.log("the other member:", String(F(process, "no such event")));
} catch (error) {
  console.log("the other member threw " + error.constructor.name + ": " + error.message);
}
