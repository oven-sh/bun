// `ns.f()` and `require(..).f()` pass the namespace object as `this`; a named import passes undefined.
import * as ns from "./m.mjs";
import { who } from "./m.mjs";
console.log(ns.who(), who(), require("./m.mjs").who());
