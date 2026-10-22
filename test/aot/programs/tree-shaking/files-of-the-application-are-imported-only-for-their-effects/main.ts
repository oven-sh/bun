// No package.json says anything, so each file runs: one imported without names, one of which no name is used in a JavaScript importer, one behind a barrel of which another name is used. `bun run` and `bun build --compile` print the same.
import "./registers";
import { used } from "./barrel";
import { fromJavaScript } from "./importer.js";
import { registry } from "./registry";

console.log(used(), fromJavaScript());
console.log(registry.map(entry => entry()).join(", "));
