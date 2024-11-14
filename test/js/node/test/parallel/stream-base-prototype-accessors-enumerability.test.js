//#FILE: test-stream-base-prototype-accessors-enumerability.js
//#SHA1: a5423c2b42bae0fbdd1530553de4d40143c010cf
//-----------------
"use strict";

// This tests that the prototype accessors added by StreamBase::AddMethods
// are not enumerable. They could be enumerated when inspecting the prototype
// with util.inspect or the inspector protocol.

// Or anything that calls StreamBase::AddMethods when setting up its prototype
const TTY = process.binding("tty_wrap").TTY;

test("StreamBase prototype accessors are not enumerable", () => {
  const ttyIsEnumerable = Object.prototype.propertyIsEnumerable.bind(TTY);
  expect(ttyIsEnumerable("bytesRead")).toBe(false);
  expect(ttyIsEnumerable("fd")).toBe(false);
  expect(ttyIsEnumerable("_externalStream")).toBe(false);
});

//<#END_FILE: test-stream-base-prototype-accessors-enumerability.js
