import { it, expect } from "bun:test";

it("setTimeout", async () => {
  var lastID = -1;
  const result = await new Promise((resolve, reject) => {
    var numbers = [];

    for (let i = 0; i < 10; i++) {
      const id = setTimeout(
        (...args) => {
          numbers.push(i);
          if (i === 9) {
            resolve(numbers);
          }
          try {
            expect(args.length).toBe(1);
            expect(args[0]).toBe("foo");
          } catch (err) {
            reject(err);
          }
        },
        i,
        "foo",
      );
      expect(id > lastID).toBe(true);
      lastID = id;
    }
  });

  for (let j = 0; j < result.length; j++) {
    expect(result[j]).toBe(j);
  }
  expect(result.length).toBe(10);
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
    setTimeout(resolve, 10);
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
