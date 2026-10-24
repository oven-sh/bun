// Three CommonJS files that an ES module imports, and a fourth below an ES module between them. The compiled program runs them depth first in the order of the import statements, before every ES body. One of them looks at its module object. `bun run` runs them in the order in which its loader finished fetching them, so the expected output is written down.
import "./k1.cjs";
import "./k2.cjs";
import "./e.mjs";
import "./k3.cjs";
console.log("main");
