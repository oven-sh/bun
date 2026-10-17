// Sloppy-mode JavaScript: `arguments` aliases the parameters, an undeclared name becomes a global, and a direct `eval` stores to a local.
import sloppy from "./untyped/sloppy.js"
console.log(sloppy.run())
console.log(sloppy.direct())
