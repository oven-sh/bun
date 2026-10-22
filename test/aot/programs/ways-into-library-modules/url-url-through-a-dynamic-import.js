// One name of node:url is imported and used; another, Url, is found through import() of the module's name under a name that is put together at run time, and is used too.
import { fileURLToPath } from "node:url";
const seen = [];
console.log("the name that is imported:", String(fileURLToPath("file:///a/b")));
const key = ["U", "rl"].join("");
const whole = await import("node:url");
const F = whole[key];
try {
  console.log("the other member:", String(new F().parse("http://host/path").host));
} catch (error) {
  console.log("the other member threw " + error.constructor.name + ": " + error.message);
}
