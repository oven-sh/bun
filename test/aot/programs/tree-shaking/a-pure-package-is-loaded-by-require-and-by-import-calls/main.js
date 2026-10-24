// "sideEffects": false, and the package is loaded by require(), by import() and through the application's own `export *`. None of these says which names are used. `bun run` and `bun build --compile` print the same.
import { viaOwnBarrel } from "./barrel.js";

console.log(viaOwnBarrel());
console.log(require("loaded/required.js").viaRequire());
console.log((await import("loaded/imported.js")).viaImportCall());
const whole = require("loaded");
console.log(Object.keys(whole).sort().join());
