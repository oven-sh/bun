// "sideEffects": false on a CommonJS package whose index requires its files. One is imported by name, one through the default import, and one file only prints. `bun run` and `bun build --compile` print the same: prints.js is evaluated.
import { named } from "old-style";
import whole from "old-style";

console.log(named(), whole.viaDefault());
