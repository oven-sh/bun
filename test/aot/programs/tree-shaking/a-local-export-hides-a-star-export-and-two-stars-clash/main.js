// barrel.ts declares `hidden` itself, so the one behind `export *` is not the one that is imported. `clash` comes from two stars, so the namespace does not have it. `same` comes from two stars but is one binding, so it is there.
import { hidden, same } from "./barrel";
import * as barrel from "./barrel";

console.log(hidden(), same());
console.log(Object.keys(barrel).join(), "clash" in barrel);
