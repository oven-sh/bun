// "sideEffects": false does not mean that a file which is used has no top level: lookup() reads a table that the file fills when it is evaluated, with functions that only the table holds, and a class whose base is in another file. `bun run` also prints "unrelated.js is evaluated". `bun build --compile` leaves that file out, and --aot follows it.
import { lookup, Special } from "tables";

console.log(lookup("a"), lookup("b"));
console.log(new Special().describe());
