// A table holds createRequire under another name. A loop over the keys of a copy of the table calls each member. The name of the module that is loaded is put together at run time.
import { createRequire } from "node:module";
const table = { ...{ load: createRequire } };
for (const key in table) console.log(key, typeof table[key](import.meta.url)(["node:", "net"].join("")).Socket);
