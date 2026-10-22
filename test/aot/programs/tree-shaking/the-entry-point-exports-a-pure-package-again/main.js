// "sideEffects": false, and the entry point says `export *` and `export { x }` of the package. What an entry point exports is used, by whoever loads the executable's module, so the files behind those names are evaluated. `bun run` evaluates all three files. `bun build --compile` evaluates stars.js and named.js and leaves not-exported.js out.
export * from "handed-on/stars.js";
export { named } from "handed-on/named.js";
import { notExported } from "handed-on/not-exported.js";

console.log("main.js runs");
