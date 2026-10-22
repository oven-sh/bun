// In an ES module `require`, `module`, `exports`, `__filename` and `__dirname` are ordinary names if the file declares them. The calls here mean the file's own functions and load nothing.
import { viaParameter } from "./parameters.js";

function require(name) { return "my require of " + name; }
const module = { exports: "my module.exports", require: name => "my module.require of " + name };
const exports = { value: "my exports" };
const __filename = "my __filename";
const __dirname = "my __dirname";

console.log(require("./not-a-file.js"), require("node:fs"));
console.log(module.exports, module.require("./not-a-file.js"), exports.value, __filename, __dirname);
console.log(viaParameter(name => "a parameter named require got " + name));
