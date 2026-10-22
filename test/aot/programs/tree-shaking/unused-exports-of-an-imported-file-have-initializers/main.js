// values.js is imported for one name. Its other exports are read by nobody, and their initializers call something, are marked pure, or are plain values. `bun run` runs all of them. `bun build --compile` drops the call marked pure and nothing else, and --aot follows it.
import { used, log } from "./values.js";

console.log(used);
console.log(log.join("\n"));
