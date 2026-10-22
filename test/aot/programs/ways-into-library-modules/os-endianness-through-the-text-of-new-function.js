// One name of node:os is imported and used; another, endianness, is found through the text of new Function. What the text gets at answers right, or it is refused aloud: with no other error and no other answer.
import { EOL } from "node:os";
const seen = [];
console.log("the name that is imported:", String(EOL.length));
const key = ["endia", "nness"].join("");
const name = ["node:", "os"].join("");
let told;
try {
  const whole = new Function("name", "return process.getBuiltinModule(name)")(name);
  const F = whole[key];
  const answer = String(F());
  told = answer === "LE" ? "right" : "ANOTHER ANSWER: " + answer;
} catch (error) {
  told = /was not compiled into this executable|Code generation from strings disallowed/.test(error.message) ? "refused aloud" : "threw " + error.constructor.name + ": " + error.message;
}
console.log("the other member:", told === "right" || told === "refused aloud" ? "right, or refused aloud" : told);
