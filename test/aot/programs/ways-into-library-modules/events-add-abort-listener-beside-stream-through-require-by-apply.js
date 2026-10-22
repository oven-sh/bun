// One name of node:events is imported and used, and so is node:stream, which reads node:events by names of its own; another, addAbortListener, is found through require, called by apply under a name that is put together at run time, and is used too.
import { once } from "node:events";
import { PassThrough } from "node:stream";
const seen = [];
console.log("the name that is imported:", String(typeof once));
console.log("the other library module:", String(new PassThrough().readable));
const key = ["addAbort", "Listener"].join("");
const name = ["node:", "events"].join("");
const whole = require.apply(null, [name]);
const F = whole[key];
try {
  console.log("the other member:", String(typeof F(new AbortController().signal, () => {})[Symbol.dispose]));
} catch (error) {
  console.log("the other member threw " + error.constructor.name + ": " + error.message);
}
