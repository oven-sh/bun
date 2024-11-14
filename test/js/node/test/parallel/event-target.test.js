//#FILE: test-event-target.js
//#SHA1: 3e70912640aa5270e13723e1895636bfd238420a
//-----------------
"use strict";

const eventPhases = {
  NONE: 0,
  CAPTURING_PHASE: 1,
  AT_TARGET: 2,
  BUBBLING_PHASE: 3,
};

describe("Event phases", () => {
  test.each(Object.entries(eventPhases))("Event.%s should be %d", (prop, value) => {
    // Check if the value of the property matches the expected value
    expect(Event[prop]).toBe(value);

    const desc = Object.getOwnPropertyDescriptor(Event, prop);
    expect(desc.writable).toBe(false);
    expect(desc.configurable).toBe(false);
    expect(desc.enumerable).toBe(true);
  });
});

//<#END_FILE: test-event-target.js
