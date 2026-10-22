// One name of node:net is imported and used; another, Socket, is found through a package marked --external, an ES module that imports it by the name it is handed, and is used too.
import { isIP } from "node:net";
import take from "outside";
const seen = [];
console.log("the name that is imported:", String(isIP("1.1.1.1")));
const key = ["Soc", "ket"].join("");
const name = ["node:", "net"].join("");
const whole = await take(name);
const F = whole[key];
try {
  console.log("the other member:", String(new F().destroyed));
} catch (error) {
  console.log("the other member threw " + error.constructor.name + ": " + error.message);
}
