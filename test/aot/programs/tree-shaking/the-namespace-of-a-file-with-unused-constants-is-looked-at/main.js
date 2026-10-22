// Nothing names the constants of these files. One namespace is listed, one is read under a computed name, one is spread, one is required, one is given to JSON.stringify. Every export has its value there.
import * as listed from "./listed.js";
import * as computed from "./computed.js";
import * as spread from "./spread.js";
import * as printed from "./printed.js";

console.log(Object.keys(listed).join(), Object.values(listed).map(String).join());
console.log(computed["sec" + "ond"], computed["def" + "ault"].kind);
console.log(JSON.stringify({ ...spread }));
console.log(JSON.stringify(require("./required.js")));
console.log(JSON.stringify(printed));
