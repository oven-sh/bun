const c = require("./assembler-names-of-any-spelling.c");

const names = [
  "7",
  "0",
  "4294967294",
  "4294967295",
  "-1",
  "constructor",
  "toString",
  "then",
  "a b",
  "été",
  "plain",
];
for (const name of names) {
  const descriptor = Object.getOwnPropertyDescriptor(c, name);
  console.log(
    JSON.stringify(name),
    typeof descriptor?.value,
    typeof descriptor?.value === "function" ? descriptor.value() : "",
  );
}
console.log(c[7](), c[0](), Object.keys(c).slice(0, 3).join(" "));
console.log(
  Object.getPrototypeOf({}) === Object.prototype,
  typeof {}.constructor,
  typeof {}.toString,
);
