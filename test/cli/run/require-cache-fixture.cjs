// This fixture is intended to be able to run in both Node.js and Bun
const Bun = (globalThis.Bun ??= { gc() {} });

const { resolve } = require("path");

if (require.main !== module) {
  console.error(__filename, module.id);
  throw new Error("require.main !== module");
}

if (module.parent !== null) {
  console.error(module.parent);
  throw new Error("module.parent !== null");
}

if (process.mainModule !== module) {
  console.error(__filename, module.id);
  throw new Error("process.mainModule !== module");
}

if (__filename !== resolve(module.filename)) {
  console.error(__filename, module.id);
  throw new Error("__filename !== module.id");
}

if (__dirname !== resolve(module.filename, "../")) {
  console.error(__filename, module.id);
  throw new Error("__dirname !== module.filename");
}

const foo = require("./require-cache-fixture-b.cjs");

if (foo.x !== module) {
  console.error(__filename, foo);
  throw new Error("foo !== module");
}

exports.foo = foo;

var res = require.resolve;

if (require.cache[res("./require-cache-fixture-b.cjs")].exports !== exports.foo) {
  throw new Error("exports.foo !== require.cache[require.resolve('./require-cache-fixture-b')]");
}

Bun.gc(true);

delete require.cache[res("./require-cache-fixture-b.cjs")];

Bun.gc(true);

exports.bar = require("./require-cache-fixture-b.cjs");

Bun.gc(true);

if (require.cache[res("./require-cache-fixture-b.cjs")].exports !== exports.bar) {
  throw new Error("exports.bar !== require.cache[require.resolve('./require-cache-fixture-b')]");
}

if (require.cache[require.resolve("./require-cache-fixture-b.cjs")].exports === exports.foo) {
  throw new Error("exports.bar === exports.foo");
}

console.log(require.cache);

console.log("\n--pass--\n");
