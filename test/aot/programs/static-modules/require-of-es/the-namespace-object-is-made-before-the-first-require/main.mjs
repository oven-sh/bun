// The namespace object is held as a value before a function requires the module for the first time.
import * as ns from "./m.mjs";
const held = ns,
  before = held.__esModule;
(() => require("./m.mjs"))();
console.log(before, held.__esModule);
