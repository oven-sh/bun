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
  await new Promise((resolve, reject) => {
    setTimeout(() => {
      resolve();
    }, 10);
  });
  expect(called).toBe(false);
});
