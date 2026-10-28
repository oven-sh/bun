// One function calls a member of the object it is given under the key it is given. It is given an object of the program, node:path and node:module, where the key picks createRequire.
const call = (object, key, ...rest) => object[key](...rest);
console.log(call({ double: a => a * 2 }, ["dou", "ble"].join(""), 4));
console.log(call(require("node:path"), ["base", "name"].join(""), "/a/b.js"));
console.log(
  typeof call(require("node:module"), ["create", "Require"].join(""), __filename)(["node:", "net"].join("")).Socket,
);
