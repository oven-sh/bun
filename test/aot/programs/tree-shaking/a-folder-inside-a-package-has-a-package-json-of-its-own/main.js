// The package says nothing about side effects; its folder esm/ has a package.json that says false, and its folder loud/ lies under a pure package and says true. `bun run` evaluates all four files. For `bun build --compile` the package.json at the root of the package decides and the ones in the folders say nothing: both files of mixed are evaluated, none of pure-outside. --aot follows it.
import { unused as a } from "mixed/esm/index.js";
import { unused as b } from "mixed/plain.js";
import { unused as c } from "pure-outside/loud/index.js";
import { unused as d } from "pure-outside/plain.js";

console.log("main.js runs");
