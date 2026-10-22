// One name of node:diagnostics_channel is imported and used; another, channel, is found through a package marked --external, which asks process.getBuiltinModule for it, and is used too.
import { hasSubscribers } from "node:diagnostics_channel";
import take from "outside";
const seen = [];
console.log("the name that is imported:", String(hasSubscribers("x")));
const key = ["cha", "nnel"].join("");
const name = ["node:", "diagnostics_channel"].join("");
const whole = take(name);
const F = whole[key];
try {
  console.log("the other member:", String(F("x").name));
} catch (error) {
  console.log("the other member threw " + error.constructor.name + ": " + error.message);
}
