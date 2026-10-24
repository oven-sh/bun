// "sideEffects": false. The program reads the namespace of the package under a name made at run time, so every file behind the barrel is used. `bun run` and `bun build --compile` print the same.
import * as shapes from "shapes";

for (const name of ["cir" + "cle", "squ" + "are"]) console.log(shapes[name]());
