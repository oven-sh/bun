throw {
  message: "My custom error message",
  get name() {
    throw new Error("u shouldnt see this");
  },
  line: 42,
  sourceURL: "http://example.com/test.js",
};
