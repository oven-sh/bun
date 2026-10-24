// A function leaves its file under another name than its own: `as`, `as default`, `export default f`, a string name, two names at once.
import viaDefaultClause, { renamed, "a name with spaces" as spaced, once, again } from "./lib";
import viaDefaultStatement from "./statement";
import { default as viaDefaultName } from "./statement";
import * as whole from "./lib";

console.log(renamed(), viaDefaultClause(), spaced(), once(), again(), once === again);
console.log(viaDefaultStatement(), viaDefaultName === viaDefaultStatement);
console.log(whole["a name with spaces"](), whole.default());
