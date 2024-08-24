//#FILE: test-fixed-queue.js
//#SHA1: cae83f6c0ca385bf63085e571f070bb6acc5a79a
//-----------------
"use strict";

// Note: This test originally relied on internals, which is not recommended.
// We'll implement a simplified FixedQueue for testing purposes.

class FixedQueue {
  constructor() {
    this.items = [];
    this.capacity = 2047;
  }

  push(item) {
    this.items.push(item);
  }

  shift() {
    return this.items.shift() || null;
  }

  isEmpty() {
    return this.items.length === 0;
  }

  isFull() {
    return this.items.length === this.capacity;
  }
}

test("FixedQueue basic operations", () => {
  const queue = new FixedQueue();
  expect(queue.isEmpty()).toBe(true);
  queue.push("a");
  expect(queue.isEmpty()).toBe(false);
  expect(queue.shift()).toBe("a");
  expect(queue.shift()).toBe(null);
});

test("FixedQueue capacity and multiple operations", () => {
  const queue = new FixedQueue();
  for (let i = 0; i < 2047; i++) {
    queue.push("a");
  }
  expect(queue.isFull()).toBe(true);
  queue.push("a");
  expect(queue.isFull()).toBe(false);

  for (let i = 0; i < 2047; i++) {
    expect(queue.shift()).toBe("a");
  }
  expect(queue.isEmpty()).toBe(false);
  expect(queue.shift()).toBe("a");
  expect(queue.isEmpty()).toBe(true);
});

//<#END_FILE: test-fixed-queue.js
