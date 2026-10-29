// node:module is read under each of its keys, and an object is filled under the same keys: with values that are defined, with pairs, with getters that read the module themselves or through another function. createRequire is then read under its name and called.
const from = require("module");
const name = ["node:", "net"].join("");
const read = (holder, key) => holder[key];
const fill = define => {
  const to = {};
  for (const key of Object.keys(from)) define(to, key);
  return to;
};
const filled = {
  "values that are defined": fill((to, key) => Object.defineProperty(to, key, { value: from[key], enumerable: true })),
  "pairs": Object.fromEntries(Object.entries(from)),
  "getters": fill((to, key) => Object.defineProperty(to, key, { get: () => from[key], enumerable: true })),
  "getters that call a function": fill((to, key) =>
    Object.defineProperty(to, key, { get: () => read(from, key), enumerable: true }),
  ),
  "getters of the old kind": fill((to, key) =>
    to.__defineGetter__(key, function () {
      return from[key];
    }),
  ),
};
for (const how of Object.keys(filled))
  console.log(how + ":", typeof filled[how].createRequire(__filename)(name).Socket);
