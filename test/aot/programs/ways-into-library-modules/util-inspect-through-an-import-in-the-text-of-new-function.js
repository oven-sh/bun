// One name of node:util is imported and used; another, inspect, is found through import() in the text of new Function. What the text gets at answers right, or it is refused aloud: with no other error and no other answer.
import { format } from "node:util";
const seen = [];
console.log("the name that is imported:", String(format("%s", 1)));
const key = ["ins", "pect"].join("");
const name = ["node:", "util"].join("");
let told;
try {
  const whole = await new Function("name", "return import(name)")(name);
  const F = whole[key];
  const answer = String(F({ a: 1 }));
  told = answer === "{ a: 1 }" ? "right" : "ANOTHER ANSWER: " + answer;
} catch (error) {
  told = /was not compiled into this executable|Code generation from strings disallowed/.test(error.message) ? "refused aloud" : "threw " + error.constructor.name + ": " + error.message;
}
console.log("the other member:", told === "right" || told === "refused aloud" ? "right, or refused aloud" : told);
