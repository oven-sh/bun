// One name of node:url is imported and used; another, format, is found through a package marked --external, an ES module that imports it by the name it is handed, and is used too.
import { fileURLToPath } from "node:url";
import take from "outside";
const seen = [];
console.log("the name that is imported:", String(fileURLToPath("file:///a/b")));
const key = ["for", "mat"].join("");
const name = ["node:", "url"].join("");
const whole = await take(name);
const F = whole[key];
try {
  console.log("the other member:", String(F({ protocol: "http", host: "host", pathname: "/p" })));
} catch (error) {
  console.log("the other member threw " + error.constructor.name + ": " + error.message);
}
