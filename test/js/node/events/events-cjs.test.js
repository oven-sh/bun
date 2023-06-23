test("in cjs, events is callable", () => {
  const events = require("events");
  console.log(events);
  new events();
});
