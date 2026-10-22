// One name of node:http is imported and used; another, validateHeaderName, is found through a package marked --external, which requires the module by the name it is handed, and is used too.
import { STATUS_CODES } from "node:http";
import take from "outside";
const seen = [];
console.log("the name that is imported:", String(STATUS_CODES[200]));
const key = ["validateH", "eaderName"].join("");
const name = ["node:", "http"].join("");
const whole = take(name);
const F = whole[key];
try {
  console.log("the other member:", String(F("x")));
} catch (error) {
  console.log("the other member threw " + error.constructor.name + ": " + error.message);
}
