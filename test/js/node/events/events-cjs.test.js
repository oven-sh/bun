test("in cjs, events is callable", () => {
  const events = require("events");
  new events();
});
