//#FILE: test-fs-watch-stop-sync.js
//#SHA1: 8285d2bd43d2f9be7be525417cf51f9336b2f379
//-----------------
"use strict";

// This test checks that the `stop` event is emitted asynchronously.
//
// If it isn't asynchronous, then the listener will be called during the
// execution of `watch.stop()`. That would be a bug.
//
// If it is asynchronous, then the listener will be removed before the event is
// emitted.

const fs = require("fs");

test("stop event is emitted asynchronously", () => {
  const listener = jest.fn();

  const watch = fs.watchFile(__filename, jest.fn());
  watch.once("stop", listener);
  watch.stop();
  watch.removeListener("stop", listener);

  expect(listener).not.toHaveBeenCalled();
});

//<#END_FILE: test-fs-watch-stop-sync.js
