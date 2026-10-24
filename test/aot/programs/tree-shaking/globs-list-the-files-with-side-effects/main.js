// "sideEffects" holds two globs: "./polyfills/*.js" and "**/*.setup.js". index.js imports five files for their effects; three match. `bun run` reports all five. `bun build --compile` reports polyfills/one.js, three.setup.js and lib/four.setup.js, and --aot follows it.
import { report } from "globbed";

console.log(report());
