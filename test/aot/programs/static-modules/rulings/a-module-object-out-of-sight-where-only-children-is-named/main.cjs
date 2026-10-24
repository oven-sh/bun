// The program names `module.children` and never `parent`. Who required whom is recorded for both or for neither, so a module object that comes out of a table under a computed index shows its parent too,
// and what is stored into the parent's exports through it is what the parent's own code reads.
exports.secret = "as written";
exports.read = () => exports.secret;
const child = require("./child.cjs");
console.log(module.children.length, module.children[0].id === require.resolve("./child.cjs"));
const table = [1, child.itself, 2];
const found = table[Number(process.env.NO_SUCH_VARIABLE ?? 1)];
const key = ["par", "ent"].join("");
const above = found[key];
console.log(above === module);
above.exports.secret = "stored from outside";
console.log(exports.read());
