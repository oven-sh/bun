// One name of node:diagnostics_channel is imported and used; another, channel, is found through getBuiltinModule, imported from node:process by name under a name that is put together at run time, and is used too.
import { hasSubscribers } from "node:diagnostics_channel";
import { getBuiltinModule } from "node:process";
const seen = [];
console.log("the name that is imported:", String(hasSubscribers("x")));
const key = ["cha", "nnel"].join("");
const name = ["node:", "diagnostics_channel"].join("");
const whole = getBuiltinModule(name);
const F = whole[key];
try {
  console.log("the other member:", String(F("x").name));
} catch (error) {
  console.log("the other member threw " + error.constructor.name + ": " + error.message);
}
