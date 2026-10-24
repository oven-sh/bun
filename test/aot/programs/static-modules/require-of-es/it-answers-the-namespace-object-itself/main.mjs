// require() of an ES module answers the namespace object that `import * as` gives.
import * as ns from "./m.mjs";
const r = require("./m.mjs");
console.log(r === ns, Object.prototype.toString.call(r), Object.keys(r).join());
