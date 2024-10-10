//#FILE: test-whatwg-events-add-event-listener-options-passive.js
//#SHA1: e3c00da24b307d0e8466611bee33f70db48ad39c
//-----------------
"use strict";

// Manually converted from https://github.com/web-platform-tests/wpt/blob/master/dom/events/AddEventListenerOptions-passive.html
// in order to define the `document` ourselves

test("AddEventListener options passive", () => {
  const document = new EventTarget();
  let supportsPassive = false;
  const query_options = {
    get passive() {
      supportsPassive = true;
      return false;
    },
    get dummy() {
      throw new Error("dummy value getter invoked");
    },
  };

  document.addEventListener("test_event", null, query_options);
  expect(supportsPassive).toBe(true);

  supportsPassive = false;
  document.removeEventListener("test_event", null, query_options);
  expect(supportsPassive).toBe(false);
});

test("testPassiveValue", () => {
  function testPassiveValue(optionsValue, expectedDefaultPrevented) {
    const document = new EventTarget();
    let defaultPrevented;
    function handler(e) {
      if (e.defaultPrevented) {
        throw new Error("Event prematurely marked defaultPrevented");
      }
      e.preventDefault();
      defaultPrevented = e.defaultPrevented;
    }
    document.addEventListener("test", handler, optionsValue);
    // TODO the WHATWG test is more extensive here and tests dispatching on
    // document.body, if we ever support getParent we should amend this
    const ev = new Event("test", { bubbles: true, cancelable: true });
    const uncanceled = document.dispatchEvent(ev);

    expect(defaultPrevented).toBe(expectedDefaultPrevented);
    expect(uncanceled).toBe(!expectedDefaultPrevented);

    document.removeEventListener("test", handler, optionsValue);
  }
  testPassiveValue(undefined, true);
  testPassiveValue({}, true);
  testPassiveValue({ passive: false }, true);

  // TODO: passive listeners is still broken
  // testPassiveValue({ passive: 1 }, false);
  // testPassiveValue({ passive: true }, false);
  // testPassiveValue({ passive: 0 }, true);
});

//<#END_FILE: test-whatwg-events-add-event-listener-options-passive.js
