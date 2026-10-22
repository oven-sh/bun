// Sloppy-mode JavaScript: `arguments` aliases the parameters, an undeclared name becomes a global, and a direct `eval` stores to a local. One answer differs from plain Bun: a function declared in a block is also a `var` of the enclosing function (Annex B), so `typeof inner` behind the block is "function", where plain Bun says "undefined".
import sloppy from "./untyped/sloppy.js"
console.log(sloppy.run())
console.log(sloppy.direct())
