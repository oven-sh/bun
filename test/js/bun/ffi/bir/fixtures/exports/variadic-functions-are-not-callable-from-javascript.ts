import * as c from "./variadic-functions-are-not-callable-from-javascript.c";

console.log(
  Object.keys(c)
    .filter(name => name !== "default")
    .sort()
    .join(" "),
  c.w(),
);
