// Each imported file prints when it is evaluated. Of each only a type is used: an interface, a class used as a type, `import type`, an inline `type`, `typeof` of a function in a type, and a re-export of a type. `bun run` and `bun build --compile` print the same.
import { Shape } from "./interface";
import { Klass } from "./class";
import type { Other } from "./import-type";
import { type Inline } from "./inline-type";
import { fn } from "./typeof";
import { Passed } from "./re-export";
import {} from "./empty-braces";

const shape: Shape = { sides: 3 };
let klass: Klass | undefined;
let other: Other | undefined;
let inline: Inline | undefined;
let callback: typeof fn | undefined;
let passed: Passed | undefined;
console.log(shape.sides, klass, other, inline, callback, passed);
