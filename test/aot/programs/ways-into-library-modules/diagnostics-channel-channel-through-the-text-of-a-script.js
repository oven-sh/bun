// One name of node:diagnostics_channel is imported and used; another, channel, is found through the text of a vm.Script. What the text gets at answers right, or it is refused aloud: with no other error and no other answer.
import { hasSubscribers } from "node:diagnostics_channel";
const seen = [];
console.log("the name that is imported:", String(hasSubscribers("x")));
const key = ["cha", "nnel"].join("");
const name = ["node:", "diagnostics_channel"].join("");
let told;
try {
  const whole = new (await import("node:vm")).Script("process.getBuiltinModule").runInThisContext()(name);
  const F = whole[key];
  const answer = String(F("x").name);
  told = answer === "x" ? "right" : "ANOTHER ANSWER: " + answer;
} catch (error) {
  told = /was not compiled into this executable|Code generation from strings disallowed/.test(error.message) ? "refused aloud" : "threw " + error.constructor.name + ": " + error.message;
}
console.log("the other member:", told === "right" || told === "refused aloud" ? "right, or refused aloud" : told);
