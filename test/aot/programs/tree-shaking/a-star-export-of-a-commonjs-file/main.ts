// barrel.ts says `export *` of a CommonJS file and of an ES module. What the CommonJS file exports is known only when it has run.
import { fromCommonJS, fromModule } from "./barrel";
import * as barrel from "./barrel";

console.log(fromCommonJS(), fromModule());
console.log((barrel as any)["added" + "ByName"]());
