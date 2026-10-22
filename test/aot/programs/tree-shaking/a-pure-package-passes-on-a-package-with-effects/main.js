// "pure" says "sideEffects": false and re-exports from "impure", which says nothing and prints. The program uses a name of pure that has nothing to do with impure, then, in a second file, one that comes from it. `bun run` evaluates impure/never.js, impure/bare.js and impure/passed-on.js. `bun build --compile` leaves impure/never.js out: the re-export in pure/index.js is not used. The bare import in the same file stays.
import { own } from "pure";
import { second } from "./second.js";

console.log(own(), second());
