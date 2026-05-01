/** @type {import('ts-jest').JestConfigWithTsJest} */
module.exports = {
  testEnvironment: "node",
  transform: {}, // disable transforms so jest doesn't convert esm modules to commonjs
};
