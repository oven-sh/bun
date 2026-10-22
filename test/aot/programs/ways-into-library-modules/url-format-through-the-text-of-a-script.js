// One name of node:url is imported and used; another, format, is found through the text of a vm.Script. What the text gets at answers right, or it is refused aloud: with no other error and no other answer.
import { fileURLToPath } from "node:url";
const seen = [];
console.log("the name that is imported:", String(fileURLToPath("file:///a/b")));
const key = ["for", "mat"].join("");
const name = ["node:", "url"].join("");
let told;
try {
  const whole = new (await import("node:vm")).Script("process.getBuiltinModule").runInThisContext()(name);
  const F = whole[key];
  const answer = String(F({ protocol: "http", host: "host", pathname: "/p" }));
  told = answer === "http://host/p" ? "right" : "ANOTHER ANSWER: " + answer;
} catch (error) {
  told = /was not compiled into this executable|Code generation from strings disallowed/.test(error.message) ? "refused aloud" : "threw " + error.constructor.name + ": " + error.message;
}
console.log("the other member:", told === "right" || told === "refused aloud" ? "right, or refused aloud" : told);
