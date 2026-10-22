// One name of node:http is imported and used; another, Agent, is found through process.getBuiltinModule, called by an optional chain under a name that is put together at run time, and is used too.
import { STATUS_CODES } from "node:http";
const seen = [];
console.log("the name that is imported:", String(STATUS_CODES[200]));
const key = ["Ag", "ent"].join("");
const name = ["node:", "http"].join("");
const whole = process?.getBuiltinModule?.(name);
const F = whole[key];
try {
  console.log("the other member:", String(new F().maxSockets));
} catch (error) {
  console.log("the other member threw " + error.constructor.name + ": " + error.message);
}
