//#FILE: test-readline-emit-keypress-events.js
//#SHA1: 79b97832d1108222b690320e06d4028f73910125
//-----------------
"use strict";
// emitKeypressEvents is thoroughly tested in test-readline-keys.js.
// However, that test calls it implicitly. This is just a quick sanity check
// to verify that it works when called explicitly.

const readline = require("readline");
const { PassThrough } = require("stream");

const expectedSequence = ["f", "o", "o"];
const expectedKeys = [
  { sequence: "f", name: "f", ctrl: false, meta: false, shift: false },
  { sequence: "o", name: "o", ctrl: false, meta: false, shift: false },
  { sequence: "o", name: "o", ctrl: false, meta: false, shift: false },
];

test("emitKeypressEvents with stream", () => {
  const stream = new PassThrough();
  const sequence = [];
  const keys = [];

  readline.emitKeypressEvents(stream);
  stream.on("keypress", (s, k) => {
    sequence.push(s);
    keys.push(k);
  });
  stream.write("foo");

  expect(sequence).toEqual(expectedSequence);
  expect(keys).toEqual(expectedKeys);
});

test("emitKeypressEvents after attaching listener", () => {
  const stream = new PassThrough();
  const sequence = [];
  const keys = [];

  stream.on("keypress", (s, k) => {
    sequence.push(s);
    keys.push(k);
  });
  readline.emitKeypressEvents(stream);
  stream.write("foo");

  expect(sequence).toEqual(expectedSequence);
  expect(keys).toEqual(expectedKeys);
});

test("emitKeypressEvents with listener removal", () => {
  const stream = new PassThrough();
  const sequence = [];
  const keys = [];
  const keypressListener = (s, k) => {
    sequence.push(s);
    keys.push(k);
  };

  stream.on("keypress", keypressListener);
  readline.emitKeypressEvents(stream);
  stream.removeListener("keypress", keypressListener);
  stream.write("foo");

  expect(sequence).toEqual([]);
  expect(keys).toEqual([]);

  stream.on("keypress", keypressListener);
  stream.write("foo");

  expect(sequence).toEqual(expectedSequence);
  expect(keys).toEqual(expectedKeys);
});

//<#END_FILE: test-readline-emit-keypress-events.js
