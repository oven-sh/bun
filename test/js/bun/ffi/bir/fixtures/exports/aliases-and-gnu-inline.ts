import * as c from "./aliases-and-gnu-inline.c";

console.log(
  Object.keys(c)
    .filter(name => name !== "default")
    .sort()
    .join(" "),
);
console.log(c.use(), c.also_target(10), c.emitted(5));
