// An import is a live binding: after lib.ts has stored to its exported let, to its exported function declaration and to its default export's binding, the importer calls the replacement.
import viaDefault, { viaLet, declared, swap } from "./lib";
import * as lib from "./lib";

console.log(viaLet(), declared(), viaDefault(), lib.viaLet(), lib.declared());
swap();
console.log(viaLet(), declared(), viaDefault(), lib.viaLet(), lib.declared());
