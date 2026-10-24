// A require in each arm of a conditional expression: one module runs.
const a = process.argv.length > 99 ? require("./x.cjs") : require("./y.cjs");
console.log(a.n);
