// "sideEffects": false, and the package does have effects. It is imported three times for nothing: without names, for a name that is not used, and as a namespace that is not used. `bun run` evaluates the three files and prints "function function function". `bun build --compile` evaluates none of them and prints "undefined undefined undefined", and --aot follows it.
import "says-it-is-pure";
import { unused } from "says-it-is-pure/named.js";
import * as alsoUnused from "says-it-is-pure/namespace.js";

console.log(typeof globalThis.setByBareImport, typeof globalThis.setByNamedImport, typeof globalThis.setByNamespaceImport);
