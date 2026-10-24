// Adding a file never changes whether a line throws. `lines.ts` is that of type-rules/throwing-lines-alone, and its lines print the same here, where `other.ts` also calls its functions: as values, through `any`, with a proxy, an instance of a class and an object that inherits its fields.
import { run } from "./lines";
import { useOtherwise } from "./other";
useOtherwise();
run(JSON.parse('{"x":"1","y":2}'), "text");
useOtherwise();
