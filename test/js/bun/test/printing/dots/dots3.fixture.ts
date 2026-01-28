test.each(Array.from({ length: 10 }, () => 0))("pass", () => {});

// unhandled failure. it should print the filename
test("failure", async () => {
  const { resolve, reject, promise } = Promise.withResolvers();
  setTimeout(() => {
    resolve();
    throw new Error("unhandled error");
  }, 0);
  await promise;
});
