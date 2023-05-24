const foo = require("./require-cache-fixture-b.cjs");

exports.foo = foo;

if (require.cache[require.resolve("./require-cache-fixture-b.cjs")].exports !== exports.foo) {
  throw new Error("exports.foo !== require.cache[require.resolve('./require-cache-fixture-b')]");
}

delete require.cache[require.resolve("./require-cache-fixture-b.cjs")];

exports.bar = require("./require-cache-fixture-b.cjs");

if (require.cache[require.resolve("./require-cache-fixture-b.cjs")].exports !== exports.bar) {
  throw new Error("exports.bar !== require.cache[require.resolve('./require-cache-fixture-b')]");
}

if (require.cache[require.resolve("./require-cache-fixture-b.cjs")].exports === exports.foo) {
  throw new Error("exports.bar === exports.foo");
}

console.log(require.cache);

console.log("\n--pass--\n");
