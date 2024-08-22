//#FILE: test-timers-clear-timeout-interval-equivalent.js
//#SHA1: 2c98894fc8abe7d6e800533325274f39f9a16ff4
//-----------------
"use strict";

// This test makes sure that timers created with setTimeout can be disarmed by
// clearInterval and that timers created with setInterval can be disarmed by
// clearTimeout.
//
// This behavior is documented in the HTML Living Standard:
//
// * Refs: https://html.spec.whatwg.org/multipage/timers-and-user-prompts.html#dom-setinterval

test("Disarm interval with clearTimeout", () => {
  const mockCallback = jest.fn();
  const interval = setInterval(mockCallback, 1);
  clearTimeout(interval);

  return new Promise(resolve => {
    setTimeout(() => {
      expect(mockCallback).not.toHaveBeenCalled();
      resolve();
    }, 10);
  });
});

test("Disarm timeout with clearInterval", () => {
  const mockCallback = jest.fn();
  const timeout = setTimeout(mockCallback, 1);
  clearInterval(timeout);

  return new Promise(resolve => {
    setTimeout(() => {
      expect(mockCallback).not.toHaveBeenCalled();
      resolve();
    }, 10);
  });
});

//<#END_FILE: test-timers-clear-timeout-interval-equivalent.js
