// One name of node:fs is imported and used; another, readdirSync, is found through text given to vm.runInThisContext. What the text gets at answers right, or it is refused aloud: with no other error and no other answer.
import { existsSync } from "node:fs";
const seen = [];
console.log("the name that is imported:", String(existsSync("/")));
const key = ["readd", "irSync"].join("");
const name = ["node:", "fs"].join("");
let told;
try {
  const whole = (await import("node:vm")).runInThisContext("process.getBuiltinModule")(name);
  const F = whole[key];
  const answer = String(Array.isArray(F("/")));
  told = answer === "true" ? "right" : "ANOTHER ANSWER: " + answer;
} catch (error) {
  told = /was not compiled into this executable|Code generation from strings disallowed/.test(error.message) ? "refused aloud" : "threw " + error.constructor.name + ": " + error.message;
}
console.log("the other member:", told === "right" || told === "refused aloud" ? "right, or refused aloud" : told);
