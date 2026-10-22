// One name of node:querystring is imported and used; another, stringify, is found through the text of a direct eval. What the text gets at answers right, or it is refused aloud: with no other error and no other answer.
import { escape } from "node:querystring";
const seen = [];
console.log("the name that is imported:", String(escape("a b")));
const key = ["stri", "ngify"].join("");
const name = ["node:", "querystring"].join("");
let told;
try {
  const whole = eval("process.getBuiltinModule(name)");
  const F = whole[key];
  const answer = String(F({ a: 1 }));
  told = answer === "a=1" ? "right" : "ANOTHER ANSWER: " + answer;
} catch (error) {
  told = /was not compiled into this executable|Code generation from strings disallowed/.test(error.message) ? "refused aloud" : "threw " + error.constructor.name + ": " + error.message;
}
console.log("the other member:", told === "right" || told === "refused aloud" ? "right, or refused aloud" : told);
