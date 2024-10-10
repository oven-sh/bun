//#FILE: test-messageevent-brandcheck.js
//#SHA1: 1b04c8b7c45fe0f2fe12018ca10137eefa892b4c
//-----------------
"use strict";

test("MessageEvent brand checks", () => {
  ["data", "origin", "lastEventId", "source", "ports"].forEach(prop => {
    expect(() => Reflect.get(MessageEvent.prototype, prop, {})).toThrow(
      expect.objectContaining({
        name: "TypeError",
        message: expect.any(String),
      }),
    );
  });
});

//<#END_FILE: test-messageevent-brandcheck.js
