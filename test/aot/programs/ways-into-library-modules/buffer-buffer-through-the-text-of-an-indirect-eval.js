// One name of node:buffer is imported and used; another, Buffer, is found through the text of an indirect eval. What the text gets at answers right, or it is refused aloud: with no other error and no other answer.
import { kMaxLength } from "node:buffer";
const seen = [];
console.log("the name that is imported:", String(typeof kMaxLength));
const key = ["Buf", "fer"].join("");
const name = ["node:", "buffer"].join("");
let told;
try {
  const whole = (0, eval)("process.getBuiltinModule")(name);
  const F = whole[key];
  const answer = String(F.from("a").toString("hex"));
  told = answer === "61" ? "right" : "ANOTHER ANSWER: " + answer;
} catch (error) {
  told = /was not compiled into this executable|Code generation from strings disallowed/.test(error.message) ? "refused aloud" : "threw " + error.constructor.name + ": " + error.message;
}
console.log("the other member:", told === "right" || told === "refused aloud" ? "right, or refused aloud" : told);
