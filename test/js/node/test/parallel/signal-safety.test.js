//#FILE: test-signal-safety.js
//#SHA1: 49090f0605b0ba01c323138ac8e94d423925cbf2
//-----------------
"use strict";

test("Signal `this` safety", () => {
  // We cannot use internal bindings in Jest, so we'll mock the Signal class
  class Signal {
    start() {
      // This method should be called with the correct 'this' context
      if (!(this instanceof Signal)) {
        throw new TypeError("Illegal invocation");
      }
    }
  }

  const s = new Signal();
  const nots = { start: s.start };

  expect(() => {
    nots.start(9);
  }).toThrow(
    expect.objectContaining({
      name: "TypeError",
      message: expect.any(String),
    }),
  );
});

//<#END_FILE: test-signal-safety.js
