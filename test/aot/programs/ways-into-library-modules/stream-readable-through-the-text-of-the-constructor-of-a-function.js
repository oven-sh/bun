// One name of node:stream is imported and used; another, Readable, is found through text given to the constructor property of a function. What the text gets at answers right, or it is refused aloud: with no other error and no other answer.
import { finished } from "node:stream";
const seen = [];
console.log("the name that is imported:", String(typeof finished));
const key = ["Read", "able"].join("");
const name = ["node:", "stream"].join("");
let told;
try {
  const whole = (() => {}).constructor("name", "return process.getBuiltinModule(name)")(name);
  const F = whole[key];
  const answer = String((await F.from(["a", "b"]).toArray()).join());
  told = answer === "a,b" ? "right" : "ANOTHER ANSWER: " + answer;
} catch (error) {
  told = /was not compiled into this executable|Code generation from strings disallowed/.test(error.message) ? "refused aloud" : "threw " + error.constructor.name + ": " + error.message;
}
console.log("the other member:", told === "right" || told === "refused aloud" ? "right, or refused aloud" : told);
