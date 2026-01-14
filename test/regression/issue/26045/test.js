const moduleA = require("module-a");
const moduleB = require("module-b");

console.log(
  JSON.stringify({
    moduleA_keys: Object.keys(moduleA),
    moduleB_keys: Object.keys(moduleB),
    moduleA_functionA_type: typeof moduleA.functionA,
    moduleB_functionB_type: typeof moduleB.functionB,
  }),
);
