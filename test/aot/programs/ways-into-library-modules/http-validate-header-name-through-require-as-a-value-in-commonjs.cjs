// One name of node:http is imported and used; another, validateHeaderName, is found through require, taken as a value in a CommonJS file under a name that is put together at run time, and is used too.
const { STATUS_CODES } = require("node:http");
const seen = [];
console.log("the name that is imported:", String(STATUS_CODES[200]));
const key = ["validateH", "eaderName"].join("");
const name = ["node:", "http"].join("");
const load = require;
const whole = [name].map(load)[0];
const F = whole[key];
try {
  console.log("the other member:", String(F("x")));
} catch (error) {
  console.log("the other member threw " + error.constructor.name + ": " + error.message);
}
