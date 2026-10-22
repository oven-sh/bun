// `__esModule` on the namespace object of an ES module: undefined until the first require() of the module, true from then on, for importers too, and no own property.
import * as ns from "./m.mjs";
const before = ns.__esModule,
  r = require("./m.mjs");
console.log(before, r.__esModule, ns.__esModule, Object.getOwnPropertyNames(r).join());
