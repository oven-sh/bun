//#FILE: test-whatwg-events-event-constructors.js
//#SHA1: cf82cf4c0bfbf8bd7cdc9e9328587c2a1266cad8
//-----------------
"use strict";

// Source: https://github.com/web-platform-tests/wpt/blob/6cef1d2087d6a07d7cc6cee8cf207eec92e27c5f/dom/events/Event-constructors.any.js#L91-L112
test("Event constructor with getter options", () => {
  const called = [];
  const ev = new Event("Xx", {
    get cancelable() {
      called.push("cancelable");
      return false;
    },
    get bubbles() {
      called.push("bubbles");
      return true;
    },
    get sweet() {
      called.push("sweet");
      return "x";
    },
  });

  expect(called).toEqual(["bubbles", "cancelable"]);
  expect(ev.type).toBe("Xx");
  expect(ev.bubbles).toBe(true);
  expect(ev.cancelable).toBe(false);
  expect(ev.sweet).toBeUndefined();
});

//<#END_FILE: test-whatwg-events-event-constructors.js
