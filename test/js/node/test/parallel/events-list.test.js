//#FILE: test-events-list.js
//#SHA1: 946973d6c9e19c6410b4486cbef3e2ed032715fc
//-----------------
"use strict";

const EventEmitter = require("events");

test("EventEmitter.eventNames()", () => {
  const EE = new EventEmitter();
  const m = () => {};

  EE.on("foo", () => {});
  expect(EE.eventNames()).toEqual(["foo"]);

  EE.on("bar", m);
  expect(EE.eventNames()).toEqual(["foo", "bar"]);

  EE.removeListener("bar", m);
  expect(EE.eventNames()).toEqual(["foo"]);

  const s = Symbol("s");
  EE.on(s, m);
  expect(EE.eventNames()).toEqual(["foo", s]);

  EE.removeListener(s, m);
  expect(EE.eventNames()).toEqual(["foo"]);
});

//<#END_FILE: test-events-list.js
