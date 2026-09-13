import * as c from "./inline-definitions-and-linkage.c";

console.log(
  Object.keys(c)
    .filter(name => name !== "default")
    .sort()
    .join(" "),
);
console.log(c.run(5), c.extern_inline(1), c.declared_plain(1));
