// One name of node:net is imported and used; another, isIPv6, is found through text given to Reflect.construct of Function. What the text gets at answers right, or it is refused aloud: with no other error and no other answer.
import { isIP } from "node:net";
const seen = [];
console.log("the name that is imported:", String(isIP("1.1.1.1")));
const key = ["isI", "Pv6"].join("");
const name = ["node:", "net"].join("");
let told;
try {
  const whole = Reflect.construct(Function, ["name", "return process.getBuiltinModule(name)"])(name);
  const F = whole[key];
  const answer = String(F("::1"));
  told = answer === "true" ? "right" : "ANOTHER ANSWER: " + answer;
} catch (error) {
  told = /was not compiled into this executable|Code generation from strings disallowed/.test(error.message) ? "refused aloud" : "threw " + error.constructor.name + ": " + error.message;
}
console.log("the other member:", told === "right" || told === "refused aloud" ? "right, or refused aloud" : told);
