//#FILE: test-domain-thrown-error-handler-stack.js
//#SHA1: fd9aef2a4c852c0d092708bb6e712ad345cd4d2d
//-----------------
"use strict";

const domain = require("domain");

// Make sure that when an error is thrown from a nested domain, its error
// handler runs outside of that domain, but within the context of any parent
// domain.

test("nested domain error handling", () => {
  const d = domain.create();
  const d2 = domain.create();

  d2.on("error", err => {
    expect(domain._stack.length).toBe(1);
    expect(process.domain).toBe(d);

    process.nextTick(() => {
      expect(domain._stack.length).toBe(1);
      expect(process.domain).toBe(d);
    });
  });

  expect(() => {
    d.run(() => {
      d2.run(() => {
        throw new Error("oops");
      });
    });
  }).toThrow(
    expect.objectContaining({
      message: expect.any(String),
    }),
  );
});

//<#END_FILE: test-domain-thrown-error-handler-stack.js
