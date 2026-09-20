import * as c from "./aggregates-cross-only-between-c-functions.c";

console.log(
  Object.keys(c)
    .filter(name => name !== "default")
    .sort()
    .join(" "),
);
console.log(c.use(20n), c.real_of_rotated(3, 4));
