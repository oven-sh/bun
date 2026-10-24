// "sideEffects": ["./setup.js"]. index.js imports setup.js and extra.js for their effects: each puts a function into the registry. Only setup.js is listed. `bun run` prints both plugins. `bun build --compile` leaves extra.js out and prints the plugin of setup.js alone, and --aot follows it.
import { run } from "plugins";

console.log(run());
