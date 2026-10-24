// A CommonJS file that says __esModule, as a compiler writes it: its `default` is what a default import gets. One without the marker: the default import is the whole exports object.
import marked, { named as namedOfMarked } from "./marked.cjs";
import unmarked, { named as namedOfUnmarked } from "./unmarked.cjs";
import * as markedNamespace from "./marked.cjs";

console.log(marked(), namedOfMarked());
console.log(typeof unmarked, unmarked.default(), unmarked.named(), namedOfUnmarked());
console.log(markedNamespace.default === marked, Object.keys(markedNamespace).sort().join());
console.log(require("./marked.cjs").default(), require("./real.ts").default(), require("./real.ts").__esModule);
