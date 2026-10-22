// One name of node:readline is imported and used; another, createInterface, is found through Module.prototype.require under a name that is put together at run time, and is used too.
import { clearLine } from "node:readline";
import Module from "node:module";
const seen = [];
console.log("the name that is imported:", String(typeof clearLine));
const key = ["createI", "nterface"].join("");
const name = ["node:", "readline"].join("");
const whole = Module.prototype.require.call(new Module("x"), name);
const F = whole[key];
try {
  console.log("the other member:", String((lines => (lines.close(), lines.closed))(F({ input: new (await import("node:stream")).PassThrough() }))));
} catch (error) {
  console.log("the other member threw " + error.constructor.name + ": " + error.message);
}
