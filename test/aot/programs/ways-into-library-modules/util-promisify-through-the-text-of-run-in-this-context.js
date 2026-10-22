// One name of node:util is imported and used; another, promisify, is found through text given to vm.runInThisContext. What the text gets at answers right, or it is refused aloud: with no other error and no other answer.
import { format } from "node:util";
const seen = [];
console.log("the name that is imported:", String(format("%s", 1)));
const key = ["prom", "isify"].join("");
const name = ["node:", "util"].join("");
let told;
try {
  const whole = (await import("node:vm")).runInThisContext("process.getBuiltinModule")(name);
  const F = whole[key];
  const answer = String(await F(callback => callback(null, 5))());
  told = answer === "5" ? "right" : "ANOTHER ANSWER: " + answer;
} catch (error) {
  told = /was not compiled into this executable|Code generation from strings disallowed/.test(error.message) ? "refused aloud" : "threw " + error.constructor.name + ": " + error.message;
}
console.log("the other member:", told === "right" || told === "refused aloud" ? "right, or refused aloud" : told);
