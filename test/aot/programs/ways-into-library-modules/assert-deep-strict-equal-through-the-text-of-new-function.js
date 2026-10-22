// One name of node:assert is imported and used; another, deepStrictEqual, is found through the text of new Function. What the text gets at answers right, or it is refused aloud: with no other error and no other answer.
import { ok } from "node:assert";
const seen = [];
console.log("the name that is imported:", String(ok(true)));
const key = ["deepStr", "ictEqual"].join("");
const name = ["node:", "assert"].join("");
let told;
try {
  const whole = new Function("name", "return process.getBuiltinModule(name)")(name);
  const F = whole[key];
  const answer = String(F([1], [1]));
  told = answer === "undefined" ? "right" : "ANOTHER ANSWER: " + answer;
} catch (error) {
  told = /was not compiled into this executable|Code generation from strings disallowed/.test(error.message) ? "refused aloud" : "threw " + error.constructor.name + ": " + error.message;
}
console.log("the other member:", told === "right" || told === "refused aloud" ? "right, or refused aloud" : told);
