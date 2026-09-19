import * as c from "./hidden-functions-are-the-programs-own.c";

console.log(
  Object.keys(c)
    .filter(name => name !== "default")
    .sort()
    .join(" "),
);
console.log(c.uses_them(10), c.by_default(10), c.protected_one(10));
