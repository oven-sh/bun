// Two modules each declare a class `Item`. What --aot holds an object to goes by the class that made it, not by the name of that class.
import { makeA, readA } from "./a";
import { makeB, readB } from "./b";
import { run } from "./untyped.cjs";
for (const line of run({ makeA, makeB, readA, readB })) console.log(line);
