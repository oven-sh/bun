// One name of node:net is imported and used; another, Socket, is found through getBuiltinModule of the default import of node:process under a name that is put together at run time, and is used too.
import { isIP } from "node:net";
import host from "node:process";
const seen = [];
console.log("the name that is imported:", String(isIP("1.1.1.1")));
const key = ["Soc", "ket"].join("");
const name = ["node:", "net"].join("");
const whole = host.getBuiltinModule(name);
const F = whole[key];
try {
  console.log("the other member:", String(new F().destroyed));
} catch (error) {
  console.log("the other member threw " + error.constructor.name + ": " + error.message);
}
