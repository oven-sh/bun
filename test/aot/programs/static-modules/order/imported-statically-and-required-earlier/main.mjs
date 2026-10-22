// An ES module that the entry point imports is required earlier, by a CommonJS file of the same graph.
import "./early.cjs";
import { v } from "./x.mjs";
console.log("main", v);
