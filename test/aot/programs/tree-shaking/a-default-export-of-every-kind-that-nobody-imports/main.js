// Each file has a default export and a named one; only the named one is imported. The default is a literal, an object, an array, a name, a function, a class, an arrow function, a call, a marked call, a conditional, a template, a `new`. Those that do something do it. `bun run` also makes the marked call; `bun build --compile` does not.
import { log } from "./log.js";
import { named as a } from "./kinds/literal.js";
import { named as b } from "./kinds/object.js";
import { named as c } from "./kinds/name.js";
import { named as d } from "./kinds/function.js";
import { named as e } from "./kinds/class.js";
import { named as f } from "./kinds/arrow.js";
import { named as g } from "./kinds/call.js";
import { named as h } from "./kinds/marked-call.js";
import { named as i } from "./kinds/conditional.js";
import { named as j } from "./kinds/new.js";
import { named as k } from "./kinds/class-with-static.js";
import { named as l } from "./kinds/object-with-call.js";

console.log([a, b, c, d, e, f, g, h, i, j, k, l].join(""));
console.log(log.join("\n"));
