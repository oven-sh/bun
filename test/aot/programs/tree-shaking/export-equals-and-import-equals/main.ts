// `export =` of a function, of a class merged with a namespace and of an object, each imported with `import x = require()`.
import fn = require("./function");
import Klass = require("./class");
import table = require("./object");

console.log(fn());
console.log(new Klass().method(), Klass.helper());
console.log(table.entry(), table.renamed());
