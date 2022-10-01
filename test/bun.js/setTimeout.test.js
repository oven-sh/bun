import { it, expect } from "bun:test";

it("setTimeout", async () => {
  var lastID = -1;
  const result = await new Promise((resolve, reject) => {
    var numbers = [];

    for (let i = 1; i < 100; i++) {
      const id = setTimeout(() => {
        numbers.push(i);
        if (i === 99) {
          resolve(numbers);
        }
      }, i);
      expect(id > lastID).toBe(true);
      lastID = id;
    }
  });

  for (let j = 0; j < result.length; j++) {
    expect(result[j]).toBe(j + 1);
  }
  expect(result.length).toBe(99);
});

it("clearTimeout", async () => {
  var called = false;
  const id = setTimeout(() => {
    called = true;
    expect(false).toBe(true);
  }, 1);
  clearTimeout(id);

  // assert it doesn't crash if you call clearTimeout twice
  clearTimeout(id);

  await new Promise((resolve, reject) => {
    setTimeout(() => {
      resolve();
    }, 10);
  });
  expect(called).toBe(false);
});

it("setTimeout(() => {}, 0)", async () => {
  var called = false;
  setTimeout(() => {
    called = true;
  }, 0);
  await new Promise((resolve, reject) => {
    setTimeout(() => {
      resolve();
    }, 10);
  });
  expect(called).toBe(true);
  var ranFirst = -1;
  setTimeout(() => {
    if (ranFirst === -1) ranFirst = 1;
  }, 1);
  setTimeout(() => {
    if (ranFirst === -1) ranFirst = 0;
  }, 0);

  await new Promise((resolve, reject) => {
    setTimeout(() => {
      resolve();
    }, 10);
  });
  expect(ranFirst).toBe(0);

  ranFirst = -1;

  const id = setTimeout(() => {
    ranFirst = 0;
  }, 0);
  clearTimeout(id);
  await new Promise((resolve, reject) => {
    setTimeout(() => {
      resolve();
    }, 10);
  });
  expect(ranFirst).toBe(-1);
});
