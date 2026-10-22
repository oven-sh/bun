// A JSON file, required twice and imported: one object in an executable. Under `bun run` a require() of a JSON file that an ES module has imported answers the namespace object, which is read-only:
// "1 true TypeError undefined 1 1 false a,default". The expected output is written down: it is that of an executable before and behind static modules.
import data, { a } from "./data.json";
const required = require("./data.json");
const same = required === require("./data.json");
let outcome = "stored";
try {
  required.b = 2;
} catch (error) {
  outcome = error.constructor.name;
}
console.log(required.a, same, outcome, require("./data.json").b, data.a, a, required === data, Object.keys(required).join());
