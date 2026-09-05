import { expect, mock, test } from "bun:test";

// Rejection value must be the underlying Error, not the JSC::Exception wrapper.
test("Bun.write rejection for invalid S3 options is a proper Error", async () => {
  const s3file = Bun.s3.file("test.txt");
  const promise = Bun.write(s3file, new Blob(["hello"]), { accessKeyId: 123 as any });

  let caught: unknown;
  await promise.catch(e => {
    caught = e;
  });

  expect(caught).toBeDefined();
  expect(caught).toBeInstanceOf(Error);
  expect(Object.prototype.toString.call(caught)).toBe("[object Error]");
  expect((caught as Error).message).toContain("accessKeyId");

  const m = mock();
  m.mockRejectedValue(caught);
  await expect(m()).rejects.toBe(caught);
});
