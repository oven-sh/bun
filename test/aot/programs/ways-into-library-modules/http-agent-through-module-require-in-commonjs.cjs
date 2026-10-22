// One name of node:http is imported and used; another, Agent, is found through module.require in a CommonJS file under a name that is put together at run time, and is used too.
const { STATUS_CODES } = require("node:http");
const seen = [];
console.log("the name that is imported:", String(STATUS_CODES[200]));
const key = ["Ag", "ent"].join("");
const name = ["node:", "http"].join("");
const whole = module.require(name);
const F = whole[key];
try {
  console.log("the other member:", String(new F().maxSockets));
} catch (error) {
  console.log("the other member threw " + error.constructor.name + ": " + error.message);
}
