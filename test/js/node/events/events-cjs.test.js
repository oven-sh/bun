test("in cjs, events is callable", () => {
  const EventEmitter = require("events");
  new EventEmitter();
});
