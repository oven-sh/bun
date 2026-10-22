// One name of node:diagnostics_channel is imported and used; another, channel, is found through module.require, bound, in a CommonJS file under a name that is put together at run time, and is used too.
const { hasSubscribers } = require("node:diagnostics_channel");
const seen = [];
console.log("the name that is imported:", String(hasSubscribers("x")));
const key = ["cha", "nnel"].join("");
const name = ["node:", "diagnostics_channel"].join("");
const whole = module.require.bind(module)(name);
const F = whole[key];
try {
  console.log("the other member:", String(F("x").name));
} catch (error) {
  console.log("the other member threw " + error.constructor.name + ": " + error.message);
}
