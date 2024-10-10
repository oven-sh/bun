//#FILE: test-readline-interface-escapecodetimeout.js
//#SHA1: 6d32b42ce02228999a37e3f7017ddd747b346d5c
//-----------------
"use strict";

const readline = require("readline");
const EventEmitter = require("events").EventEmitter;

// This test ensures that the escapeCodeTimeout option set correctly

class FakeInput extends EventEmitter {
  resume() {}
  pause() {}
  write() {}
  end() {}
}

test("escapeCodeTimeout option is set correctly", () => {
  const fi = new FakeInput();
  const rli = new readline.Interface({
    input: fi,
    output: fi,
    escapeCodeTimeout: 50,
  });
  expect(rli.escapeCodeTimeout).toBe(50);
  rli.close();
});

test.each([null, {}, NaN, "50"])("invalid escapeCodeTimeout input throws TypeError", invalidInput => {
  const fi = new FakeInput();
  expect(() => {
    const rli = new readline.Interface({
      input: fi,
      output: fi,
      escapeCodeTimeout: invalidInput,
    });
    rli.close();
  }).toThrow(
    expect.objectContaining({
      name: "TypeError",
      code: "ERR_INVALID_ARG_VALUE",
      message: expect.any(String),
    }),
  );
});

//<#END_FILE: test-readline-interface-escapecodetimeout.js
