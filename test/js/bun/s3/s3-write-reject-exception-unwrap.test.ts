import { expect, test, mock } from "bun:test";

// When Bun.write(s3File, ..., options) fails while parsing `options`, the
// returned promise must be rejected with the underlying Error instance and
// not the internal JSC::Exception wrapper. Leaking the wrapper caused
// `e instanceof Error` to be false and, if the value was fed back into a
// native promise rejection (e.g. mock().mockRejectedValue(e)), triggered
// ASSERT(!value.inherits<Exception>()) in JSPromise::reject.

test("Bun.write rejection for invalid S3 options is a proper Error", async () => {
  const s3file = Bun.s3.file("test.txt");
  // accessKeyId must be a string; passing a number throws an argument-type
  // error inside getCredentialsWithOptions.
  const promise = Bun.write(s3file, new Blob(["hello"]), { accessKeyId: 123 as any });

  let caught: unknown;
  await promise.catch(e => {
    caught = e;
  });

  expect(caught).toBeDefined();
  expect(caught).toBeInstanceOf(Error);
  expect(Object.prototype.toString.call(caught)).toBe("[object Error]");
  expect((caught as Error).message).toContain("accessKeyId");

  // Feeding the rejection value back into mockRejectedValue should not crash.
  const m = mock();
  m.mockRejectedValue(caught);
  await expect(m()).rejects.toBe(caught);
});
