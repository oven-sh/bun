//#FILE: test-event-emitter-emit-context.js
//#SHA1: 66f963c1a1351deff53d036d86f821c5e932c832
//-----------------
"use strict";
const EventEmitter = require("events");

// Test emit called by other context
const EE = new EventEmitter();

// Works as expected if the context has no `constructor.name`
test("emit called with context having no constructor.name", () => {
  const ctx = { __proto__: null };
  expect(() => EE.emit.call(ctx, "error", new Error("foo"))).toThrow(
    expect.objectContaining({
      name: "Error",
      message: expect.any(String),
    }),
  );
});

test("emit called with empty object context", () => {
  expect(EE.emit.call({}, "foo")).toBe(false);
});

//<#END_FILE: test-event-emitter-emit-context.js
