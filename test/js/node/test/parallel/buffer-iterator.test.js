//#FILE: test-buffer-iterator.js
//#SHA1: cd9bcdf671dc11d86bd194aa3e7500041f03eb4c
//-----------------
"use strict";

// Buffers should be iterable
test("Buffers are iterable", () => {
  const buffer = Buffer.from([1, 2, 3, 4, 5]);
  const arr = [];

  for (const b of buffer) {
    arr.push(b);
  }

  expect(arr).toEqual([1, 2, 3, 4, 5]);
});

// Buffer iterators should be iterable
test("Buffer iterators are iterable", () => {
  const buffer = Buffer.from([1, 2, 3, 4, 5]);
  const arr = [];

  for (const b of buffer[Symbol.iterator]()) {
    arr.push(b);
  }

  expect(arr).toEqual([1, 2, 3, 4, 5]);
});

// buffer#values() should return iterator for values
test("buffer.values() returns iterator for values", () => {
  const buffer = Buffer.from([1, 2, 3, 4, 5]);
  const arr = [];

  for (const b of buffer.values()) {
    arr.push(b);
  }

  expect(arr).toEqual([1, 2, 3, 4, 5]);
});

// buffer#keys() should return iterator for keys
test("buffer.keys() returns iterator for keys", () => {
  const buffer = Buffer.from([1, 2, 3, 4, 5]);
  const arr = [];

  for (const b of buffer.keys()) {
    arr.push(b);
  }

  expect(arr).toEqual([0, 1, 2, 3, 4]);
});

// buffer#entries() should return iterator for entries
test("buffer.entries() returns iterator for entries", () => {
  const buffer = Buffer.from([1, 2, 3, 4, 5]);
  const arr = [];

  for (const b of buffer.entries()) {
    arr.push(b);
  }

  expect(arr).toEqual([
    [0, 1],
    [1, 2],
    [2, 3],
    [3, 4],
    [4, 5],
  ]);
});

//<#END_FILE: test-buffer-iterator.js
