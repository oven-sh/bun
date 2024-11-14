//#FILE: test-eventtarget-once-twice.js
//#SHA1: dd2fea0f3c839d77c64423ed3c2cbdd319365141
//-----------------
"use strict";

const { once } = require("events");

test("once can be called twice on EventTarget", async () => {
  const et = new EventTarget();

  const promise = (async () => {
    await once(et, "foo");
    await once(et, "foo");
  })();

  et.dispatchEvent(new Event("foo"));
  setImmediate(() => {
    et.dispatchEvent(new Event("foo"));
  });

  await expect(promise).resolves.toBeUndefined();
});

//<#END_FILE: test-eventtarget-once-twice.js
