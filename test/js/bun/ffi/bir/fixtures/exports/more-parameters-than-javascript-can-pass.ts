import * as c from "./more-parameters-than-javascript-can-pass.c";

console.log(
  Object.keys(c)
    .filter(name => name !== "default")
    .sort()
    .join(" "),
);
const numbers = Array.from({ length: 32 }, (_, i) => i + 1);
console.log(c.small(41), c.with_32(...numbers), c.through_c());
