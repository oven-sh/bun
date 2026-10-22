// One name of node:buffer is imported and used; another, isUtf8, is found through the text of a direct eval. What the text gets at answers right, or it is refused aloud: with no other error and no other answer.
import { kMaxLength } from "node:buffer";
const seen = [];
console.log("the name that is imported:", String(typeof kMaxLength));
const key = ["isU", "tf8"].join("");
const name = ["node:", "buffer"].join("");
let told;
try {
  const whole = eval("process.getBuiltinModule(name)");
  const F = whole[key];
  const answer = String(F(new Uint8Array([97])));
  told = answer === "true" ? "right" : "ANOTHER ANSWER: " + answer;
} catch (error) {
  told = /was not compiled into this executable|Code generation from strings disallowed/.test(error.message) ? "refused aloud" : "threw " + error.constructor.name + ": " + error.message;
}
console.log("the other member:", told === "right" || told === "refused aloud" ? "right, or refused aloud" : told);
