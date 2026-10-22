// package.json has "main" (a CommonJS file) and "module" (an ES module that is a barrel), as packages built for bundlers have. The program only imports the package. `bun run` takes "main"; `bun build --compile` takes "module". An executable built with --aot takes what `bun run` takes.
import { picked } from "by-module";

console.log(picked());
