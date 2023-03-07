import { it, expect } from "bun:test";

it("setImmediate", async () => {
  var lastID = -1;
  const result = await new Promise((resolve, reject) => {
    var numbers = [];

    for (let i = 0; i < 10; i++) {
      const id = setImmediate((...args) => {
        numbers.push(i);
        if (i === 9) {
          resolve(numbers);
        }
        try {
          expect(args.length).toBe(1);
          expect(args[0]).toBe(i);
        } catch (err) {
          reject(err);
        }
      }, i);
      expect(id > lastID).toBe(true);
      lastID = id;
    }
  });

  for (let j = 0; j < result.length; j++) {
    expect(result[j]).toBe(j);
  }
  expect(result.length).toBe(10);
});

it("clearImmediate", async () => {
  var called = false;
  const id = setImmediate(() => {
    called = true;
    expect(false).toBe(true);
  });
  clearImmediate(id);

  // assert it doesn't crash if you call clearImmediate twice
  clearImmediate(id);

  await new Promise((resolve, reject) => {
    setImmediate(resolve);
  });
  expect(called).toBe(false);
});
