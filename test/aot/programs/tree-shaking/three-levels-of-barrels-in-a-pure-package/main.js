// "sideEffects": false. The name passes three barrels; every file of the package prints when it is evaluated, the barrels too. `bun run` evaluates all nine files. `bun build --compile` evaluates helper.js, leaf.js, level-2.js and level-1.js: it leaves out the three files of which nothing is used, and index.js, whose `export *` it passes through.
import { leaf } from "deep-barrels";

console.log(leaf());
