import { order } from "./order.js";
const unused = { a: 1 };
order.push("awaits-last.js before its await");
await null;
const alsoUnused = [];
