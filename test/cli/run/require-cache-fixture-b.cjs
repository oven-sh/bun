exports.foo = 123;
exports.bar = 456;
exports.baz = 789;

if (require.main === module) {
  console.error(__filename, module.id);
  throw new Error("require.main === module");
}
