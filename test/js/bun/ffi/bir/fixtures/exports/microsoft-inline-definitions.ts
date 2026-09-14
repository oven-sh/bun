import * as c from "./microsoft-inline-definitions.c";

console.log(
  Object.keys(c)
    .filter(name => name !== "default")
    .sort()
    .join(" "),
);
console.log(c.run(5));
