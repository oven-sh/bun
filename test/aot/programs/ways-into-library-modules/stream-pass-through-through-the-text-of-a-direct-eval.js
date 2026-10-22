// One name of node:stream is imported and used; another, PassThrough, is found through the text of a direct eval. What the text gets at answers right, or it is refused aloud: with no other error and no other answer.
import { finished } from "node:stream";
const seen = [];
console.log("the name that is imported:", String(typeof finished));
const key = ["PassT", "hrough"].join("");
const name = ["node:", "stream"].join("");
let told;
try {
  const whole = eval("process.getBuiltinModule(name)");
  const F = whole[key];
  const answer = String(new F().writable);
  told = answer === "true" ? "right" : "ANOTHER ANSWER: " + answer;
} catch (error) {
  told = /was not compiled into this executable|Code generation from strings disallowed/.test(error.message) ? "refused aloud" : "threw " + error.constructor.name + ": " + error.message;
}
console.log("the other member:", told === "right" || told === "refused aloud" ? "right, or refused aloud" : told);
