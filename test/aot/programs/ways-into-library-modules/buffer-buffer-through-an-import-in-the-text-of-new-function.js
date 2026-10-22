// One name of node:buffer is imported and used; another, Buffer, is found through import() in the text of new Function. What the text gets at answers right, or it is refused aloud: with no other error and no other answer.
import { kMaxLength } from "node:buffer";
const seen = [];
console.log("the name that is imported:", String(typeof kMaxLength));
const key = ["Buf", "fer"].join("");
const name = ["node:", "buffer"].join("");
let told;
try {
  const whole = await new Function("name", "return import(name)")(name);
  const F = whole[key];
  const answer = String(F.from("a").toString("hex"));
  told = answer === "61" ? "right" : "ANOTHER ANSWER: " + answer;
} catch (error) {
  told = /was not compiled into this executable|Code generation from strings disallowed/.test(error.message) ? "refused aloud" : "threw " + error.constructor.name + ": " + error.message;
}
console.log("the other member:", told === "right" || told === "refused aloud" ? "right, or refused aloud" : told);
