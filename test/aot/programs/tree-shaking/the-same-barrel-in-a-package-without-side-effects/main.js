// The barrel of one-file-behind-a-barrel-has-an-effect, in a package that says "sideEffects": false. `bun run` prints "second.js is evaluated" and "registered by second.js". `bun build --compile` leaves second.js out and prints "nothing registered", and --aot follows it.
import { fourth, registered } from "six-files";

console.log(fourth());
console.log(registered.map(entry => entry()).join() || "nothing registered");
