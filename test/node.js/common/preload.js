const { mock } = require("bun:test");
const assert = require("./assert");

mock.module("assert", () => {
  return assert;
});

mock.module("internal/test/binding", () => {
  return {};
});
