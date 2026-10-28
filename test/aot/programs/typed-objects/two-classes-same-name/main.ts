// Two modules each declare a class `Item`. Untyped code deletes fields of their instances, lays accessors over them and gives them another prototype: every change succeeds as in plain Bun, for the one class as for the other.
import { makeA, readA } from "./a";
import { makeB, readB } from "./b";
import { run } from "./untyped.cjs";
for (const line of run({ makeA, makeB, readA, readB })) console.log(line);
