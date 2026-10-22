// A module that is imported statically, and once more by an import() in a function.
import { v } from "./x.mjs";
const again = () => import("./x.mjs");
console.log(v, (await again()).v);
