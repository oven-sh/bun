// The package.json beside the entry point says "sideEffects": false, so the rule holds for the files of the application too: a file imported for its effect, a file of which nothing is used, and a file that is used. `bun run` evaluates all three and prints "used function". `bun build --compile` evaluates used.js alone and prints "used undefined", and --aot follows it.
import "./effect.js";
import { unused } from "./unused.js";
import { used } from "./used.js";

console.log(used(), typeof globalThis.setByEffect);
