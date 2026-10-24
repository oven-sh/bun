// A `module` object that the compiler loses sight of keeps its `exports`. Its `children` and `parent` answer undefined in an executable. The expected output is written down.
const child = require("./child.cjs");
console.log(child.seen);
