// One name of node:diagnostics_channel is imported and used; another, channel, is found through a module of the program that exports its namespace under a name that is put together at run time, and is used too.
import { hasSubscribers } from "node:diagnostics_channel";
import { whole } from "./all.js";
const seen = [];
console.log("the name that is imported:", String(hasSubscribers("x")));
const key = ["cha", "nnel"].join("");
const F = whole[key];
try {
  console.log("the other member:", String(F("x").name));
} catch (error) {
  console.log("the other member threw " + error.constructor.name + ": " + error.message);
}
