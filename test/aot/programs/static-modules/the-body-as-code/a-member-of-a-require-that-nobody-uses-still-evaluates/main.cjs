// `require(K).name` evaluates K, whether or not anybody uses what it reads.
globalThis.order = [];
var unused = require("./es.mjs").name;
var alsoUnused = require("./names.cjs").name;
exports.nobodyReadsThis = require("./second-es.mjs").name;
exports.norThis = require("./second-names.cjs").name;
const { name: dropped } = require("./third-names.cjs");
require("./fourth-names.cjs").name;
console.log(order.join());
