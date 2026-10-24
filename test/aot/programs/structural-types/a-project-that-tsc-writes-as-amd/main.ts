// `module` says in which format tsc writes a file, and a build writes none. TypeScript 7 has removed "amd", "umd" and "system"; plain Bun never read the option.
import { twice } from "./helper";
import helper = require("./helper");

console.log(twice(21), helper.twice === twice);
console.log(typeof import.meta.url, await Promise.resolve(7));
