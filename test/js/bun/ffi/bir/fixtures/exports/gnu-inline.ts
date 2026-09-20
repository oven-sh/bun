import * as c from "./gnu-inline.c";

console.log(
  Object.keys(c)
    .filter(name => name !== "default")
    .sort()
    .join(" "),
);
console.log(c.use(), c.emitted(5));
