test("expect.assertions DOES fail the test, sync", async () => {
  expect.assertions(1);
});

test("expect.assertions DOES fail the test, async", async () => {
  expect.assertions(1);
  await new Promise(resolve => setTimeout(resolve, 1));
});

test("expect.assertions DOES fail the test, callback", done => {
  expect.assertions(1);
  process.nextTick(() => {
    done();
  });
});

test("expect.assertions DOES fail the test, setImmediate", done => {
  expect.assertions(1);
  setImmediate(() => {
    done();
  });
});

test("expect.assertions DOES fail the test, queueMicrotask", done => {
  expect.assertions(1);
  queueMicrotask(() => {
    done();
  });
});
