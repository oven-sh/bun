// "sideEffects": false. The program asks the barrel for `first`. first.js imports `second` from the same barrel, and second.js reads `third` off the barrel's namespace. Every file prints when it is evaluated. `bun build --compile` evaluates first.js, second.js and third.js and leaves out fourth.js; `bun run` evaluates all four.
import { first } from "asks-again";

console.log(first());
