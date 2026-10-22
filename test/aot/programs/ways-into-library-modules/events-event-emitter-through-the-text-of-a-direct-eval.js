// One name of node:events is imported and used; another, EventEmitter, is found through the text of a direct eval. What the text gets at answers right, or it is refused aloud: with no other error and no other answer.
import { once } from "node:events";
const seen = [];
console.log("the name that is imported:", String(typeof once));
const key = ["EventE", "mitter"].join("");
const name = ["node:", "events"].join("");
let told;
try {
  const whole = eval("process.getBuiltinModule(name)");
  const F = whole[key];
  const answer = String((emitter => (emitter.on("x", value => seen.push(value)), emitter.emit("x", 5), seen.join()))(new F()));
  told = answer === "5" ? "right" : "ANOTHER ANSWER: " + answer;
} catch (error) {
  told = /was not compiled into this executable|Code generation from strings disallowed/.test(error.message) ? "refused aloud" : "threw " + error.constructor.name + ": " + error.message;
}
console.log("the other member:", told === "right" || told === "refused aloud" ? "right, or refused aloud" : told);
