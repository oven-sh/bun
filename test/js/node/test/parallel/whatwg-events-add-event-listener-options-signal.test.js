//#FILE: test-whatwg-events-add-event-listener-options-signal.js
//#SHA1: 2282c25dbc2f2c8bec3b2b97e0a68f3073c75c91
//-----------------
"use strict";

// Manually ported from: wpt@dom/events/AddEventListenerOptions-signal.any.js

test("Passing an AbortSignal to addEventListener does not prevent removeEventListener", () => {
  let count = 0;
  function handler() {
    count++;
  }
  const et = new EventTarget();
  const controller = new AbortController();
  et.addEventListener("test", handler, { signal: controller.signal });
  et.dispatchEvent(new Event("test"));
  expect(count).toBe(1);
  et.dispatchEvent(new Event("test"));
  expect(count).toBe(2);
  controller.abort();
  et.dispatchEvent(new Event("test"));
  expect(count).toBe(2);
  // See: https://github.com/nodejs/node/pull/37696 , adding an event listener
  // should always return undefined.
  expect(et.addEventListener("test", handler, { signal: controller.signal })).toBeUndefined();
  et.dispatchEvent(new Event("test"));
  expect(count).toBe(2);
});

test("Passing an AbortSignal to addEventListener works with the once flag", () => {
  let count = 0;
  function handler() {
    count++;
  }
  const et = new EventTarget();
  const controller = new AbortController();
  et.addEventListener("test", handler, { signal: controller.signal });
  et.removeEventListener("test", handler);
  et.dispatchEvent(new Event("test"));
  expect(count).toBe(0);
});

test("Removing a once listener works with a passed signal", () => {
  let count = 0;
  function handler() {
    count++;
  }
  const et = new EventTarget();
  const controller = new AbortController();
  const options = { signal: controller.signal, once: true };
  et.addEventListener("test", handler, options);
  controller.abort();
  et.dispatchEvent(new Event("test"));
  expect(count).toBe(0);
});

test("Removing a once listener with options works", () => {
  let count = 0;
  function handler() {
    count++;
  }
  const et = new EventTarget();
  const controller = new AbortController();
  const options = { signal: controller.signal, once: true };
  et.addEventListener("test", handler, options);
  et.removeEventListener("test", handler);
  et.dispatchEvent(new Event("test"));
  expect(count).toBe(0);
});

test("Passing an AbortSignal to multiple listeners", () => {
  let count = 0;
  function handler() {
    count++;
  }
  const et = new EventTarget();
  const controller = new AbortController();
  const options = { signal: controller.signal, once: true };
  et.addEventListener("first", handler, options);
  et.addEventListener("second", handler, options);
  controller.abort();
  et.dispatchEvent(new Event("first"));
  et.dispatchEvent(new Event("second"));
  expect(count).toBe(0);
});

test("Passing an AbortSignal to addEventListener works with the capture flag", () => {
  let count = 0;
  function handler() {
    count++;
  }
  const et = new EventTarget();
  const controller = new AbortController();
  const options = { signal: controller.signal, capture: true };
  et.addEventListener("test", handler, options);
  controller.abort();
  et.dispatchEvent(new Event("test"));
  expect(count).toBe(0);
});

test("Aborting from a listener does not call future listeners", () => {
  let count = 0;
  function handler() {
    count++;
  }
  const et = new EventTarget();
  const controller = new AbortController();
  const options = { signal: controller.signal };
  et.addEventListener(
    "test",
    () => {
      controller.abort();
    },
    options,
  );
  et.addEventListener("test", handler, options);
  et.dispatchEvent(new Event("test"));
  expect(count).toBe(0);
});

test("Adding then aborting a listener in another listener does not call it", () => {
  let count = 0;
  function handler() {
    count++;
  }
  const et = new EventTarget();
  const controller = new AbortController();
  et.addEventListener(
    "test",
    () => {
      et.addEventListener("test", handler, { signal: controller.signal });
      controller.abort();
    },
    { signal: controller.signal },
  );
  et.dispatchEvent(new Event("test"));
  expect(count).toBe(0);
});

test("Aborting from a nested listener should remove it", () => {
  const et = new EventTarget();
  const ac = new AbortController();
  let count = 0;
  et.addEventListener(
    "foo",
    () => {
      et.addEventListener(
        "foo",
        () => {
          count++;
          if (count > 5) ac.abort();
          et.dispatchEvent(new Event("foo"));
        },
        { signal: ac.signal },
      );
      et.dispatchEvent(new Event("foo"));
    },
    { once: true },
  );
  et.dispatchEvent(new Event("foo"));
  expect(count).toBe(6);
});

test("Invalid signal values throw TypeError", () => {
  const et = new EventTarget();
  [1, 1n, {}, [], null, true, "hi", Symbol(), () => {}].forEach(signal => {
    expect(() => et.addEventListener("foo", () => {}, { signal })).toThrow(
      expect.objectContaining({
        name: "TypeError",
        message: expect.any(String),
      }),
    );
  });
});

//<#END_FILE: test-whatwg-events-add-event-listener-options-signal.js
