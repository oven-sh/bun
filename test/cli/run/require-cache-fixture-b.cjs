exports.foo = 123;
exports.bar = 456;
exports.baz = 789;

if (require.main === module) {
  console.error(__filename, module.id);
  throw new Error("require.main === module");
}

if (module.parent == null || typeof module.parent !== "object") {
  console.error(module.parent);
  throw new Error("module.parent == null");
}

module.exports = { x: module.parent };
