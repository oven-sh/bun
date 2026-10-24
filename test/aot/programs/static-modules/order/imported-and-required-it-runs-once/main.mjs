// One CommonJS file that is imported, required and loaded by import() runs once.
import "./a.cjs";
require("./a.cjs");
await import("./a.cjs");
console.log("end");
