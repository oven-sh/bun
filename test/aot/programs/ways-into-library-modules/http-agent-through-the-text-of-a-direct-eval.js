// One name of node:http is imported and used; another, Agent, is found through the text of a direct eval. What the text gets at answers right, or it is refused aloud: with no other error and no other answer.
import { STATUS_CODES } from "node:http";
const seen = [];
console.log("the name that is imported:", String(STATUS_CODES[200]));
const key = ["Ag", "ent"].join("");
const name = ["node:", "http"].join("");
let told;
try {
  const whole = eval("process.getBuiltinModule(name)");
  const F = whole[key];
  const answer = String(new F().maxSockets);
  told = answer === "Infinity" ? "right" : "ANOTHER ANSWER: " + answer;
} catch (error) {
  told = /was not compiled into this executable|Code generation from strings disallowed/.test(error.message) ? "refused aloud" : "threw " + error.constructor.name + ": " + error.message;
}
console.log("the other member:", told === "right" || told === "refused aloud" ? "right, or refused aloud" : told);
