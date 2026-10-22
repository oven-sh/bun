// One name of node:crypto is imported and used; another, timingSafeEqual, is found through the text of a vm.Script. What the text gets at answers right, or it is refused aloud: with no other error and no other answer.
import { randomUUID } from "node:crypto";
const seen = [];
console.log("the name that is imported:", String(randomUUID().length));
const key = ["timingS", "afeEqual"].join("");
const name = ["node:", "crypto"].join("");
let told;
try {
  const whole = new (await import("node:vm")).Script("process.getBuiltinModule").runInThisContext()(name);
  const F = whole[key];
  const answer = String(F(Buffer.from("a"), Buffer.from("a")));
  told = answer === "true" ? "right" : "ANOTHER ANSWER: " + answer;
} catch (error) {
  told = /was not compiled into this executable|Code generation from strings disallowed/.test(error.message) ? "refused aloud" : "threw " + error.constructor.name + ": " + error.message;
}
console.log("the other member:", told === "right" || told === "refused aloud" ? "right, or refused aloud" : told);
