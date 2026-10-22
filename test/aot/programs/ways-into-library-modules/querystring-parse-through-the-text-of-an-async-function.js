// One name of node:querystring is imported and used; another, parse, is found through text given to the constructor of async functions. What the text gets at answers right, or it is refused aloud: with no other error and no other answer.
import { escape } from "node:querystring";
const seen = [];
console.log("the name that is imported:", String(escape("a b")));
const key = ["pa", "rse"].join("");
const name = ["node:", "querystring"].join("");
let told;
try {
  const whole = await (async () => {}).constructor("name", "return process.getBuiltinModule(name)")(name);
  const F = whole[key];
  const answer = String(F("a=1&b=2").b);
  told = answer === "2" ? "right" : "ANOTHER ANSWER: " + answer;
} catch (error) {
  told = /was not compiled into this executable|Code generation from strings disallowed/.test(error.message) ? "refused aloud" : "threw " + error.constructor.name + ": " + error.message;
}
console.log("the other member:", told === "right" || told === "refused aloud" ? "right, or refused aloud" : told);
