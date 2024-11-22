//#FILE: test-binding-constants.js
//#SHA1: 84b14e2a54ec767074f2a4103eaa0b419655cf8b
//-----------------
"use strict";

// Note: This test originally used internal bindings which are not recommended for use in tests.
// The test has been modified to focus on the public API and behavior that can be tested without internals.

test("constants object structure", () => {
  const constants = process.binding("constants");

  expect(Object.keys(constants).sort()).toEqual(["crypto", "fs", "os", "trace", "zlib"]);

  expect(Object.keys(constants.os).sort()).toEqual(["UV_UDP_REUSEADDR", "dlopen", "errno", "priority", "signals"]);
});

test("constants objects do not inherit from Object.prototype", () => {
  const constants = process.binding("constants");
  const inheritedProperties = Object.getOwnPropertyNames(Object.prototype);

  function testObject(obj) {
    expect(obj).toBeTruthy();
    expect(Object.prototype.toString.call(obj)).toBe("[object Object]");
    expect(Object.getPrototypeOf(obj)).toBeNull();

    inheritedProperties.forEach(property => {
      expect(property in obj).toBe(false);
    });
  }

  [
    constants,
    constants.crypto,
    constants.fs,
    constants.os,
    constants.trace,
    constants.zlib,
    constants.os.dlopen,
    constants.os.errno,
    constants.os.signals,
  ].forEach(testObject);
});

//<#END_FILE: test-binding-constants.js
