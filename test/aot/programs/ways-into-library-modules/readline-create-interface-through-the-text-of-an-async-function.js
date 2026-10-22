// One name of node:readline is imported and used; another, createInterface, is found through text given to the constructor of async functions. What the text gets at answers right, or it is refused aloud: with no other error and no other answer.
import { clearLine } from "node:readline";
const seen = [];
console.log("the name that is imported:", String(typeof clearLine));
const key = ["createI", "nterface"].join("");
const name = ["node:", "readline"].join("");
let told;
try {
  const whole = await (async () => {}).constructor("name", "return process.getBuiltinModule(name)")(name);
  const F = whole[key];
  const answer = String((lines => (lines.close(), lines.closed))(F({ input: new (await import("node:stream")).PassThrough() })));
  told = answer === "true" ? "right" : "ANOTHER ANSWER: " + answer;
} catch (error) {
  told = /was not compiled into this executable|Code generation from strings disallowed/.test(error.message) ? "refused aloud" : "threw " + error.constructor.name + ": " + error.message;
}
console.log("the other member:", told === "right" || told === "refused aloud" ? "right, or refused aloud" : told);
