// One name of node:readline is imported and used; another, Interface, is found through text given to Reflect.construct of Function. What the text gets at answers right, or it is refused aloud: with no other error and no other answer.
import { clearLine } from "node:readline";
const seen = [];
console.log("the name that is imported:", String(typeof clearLine));
const key = ["Inte", "rface"].join("");
const name = ["node:", "readline"].join("");
let told;
try {
  const whole = Reflect.construct(Function, ["name", "return process.getBuiltinModule(name)"])(name);
  const F = whole[key];
  const answer = String(typeof F.prototype.question);
  told = answer === "function" ? "right" : "ANOTHER ANSWER: " + answer;
} catch (error) {
  told = /was not compiled into this executable|Code generation from strings disallowed/.test(error.message) ? "refused aloud" : "threw " + error.constructor.name + ": " + error.message;
}
console.log("the other member:", told === "right" || told === "refused aloud" ? "right, or refused aloud" : told);
