// "sideEffects": false. Each import of the package is used, but only inside a function, an arrow function and a method that nobody calls. One file of the application is used in the same way. `bun run` evaluates a.js, b.js, c.js and own.js. `bun build --compile` drops the three functions first, then nothing uses the package and none of its files is evaluated; own.js is, because nothing says that it has no effects. --aot follows it.
import { a } from "quiet/a.js";
import * as b from "quiet/b.js";
import c from "quiet/c.js";
import { own } from "./own.js";

function nobodyCalls() {
  return a() + own();
}
const neither = () => b.b();
class Unused {
  method() {
    return c();
  }
}

console.log("main.js runs");
