// a.ts and b.ts re-export each other with `export *`, and c.ts re-exports itself. Each name is imported from the file that does not declare it.
import { fromB, viaSelf } from "./a";
import { fromA } from "./b";
import * as a from "./a";

console.log(fromA(), fromB(), viaSelf());
console.log(Object.keys(a).join());
