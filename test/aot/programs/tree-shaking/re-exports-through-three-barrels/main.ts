// Each name passes three files that only re-export: by `export *`, by `export { x } from`, renamed on the way, as a default that becomes a name and a name that becomes the default.
import fromName, { star, named, thrice, fromDefault, Klass, constant } from "./barrel-1";

console.log(star(), named(), thrice(), fromDefault(), fromName(), new Klass().method(), constant());
