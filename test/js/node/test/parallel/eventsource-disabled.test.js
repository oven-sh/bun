//#FILE: test-eventsource-disabled.js
//#SHA1: ebb7581b56a8dd86c5385eba1befa9ef984a8065
//-----------------
"use strict";

test("EventSource is undefined", () => {
  expect(typeof EventSource).toBe("undefined");
});

//<#END_FILE: test-eventsource-disabled.js
