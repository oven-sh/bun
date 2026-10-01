// A second entry point, which nothing imports: it is loaded by name. It only re-exports from other modules.
import { askedForByName, askedForByNameToo } from "./pure6";
export { askedForByName as underAnAlias };
export const wrapped = { askedForByNameToo };
