import { expect, test } from "bun:test";

// Regression test: after Response.bytes() internally detaches the underlying
// ByteBlobLoader's store via toBlobIfPossible, the JS ReadableStream object
// returned earlier from .body is still not JS-disturbed. A subsequent call to
// .blob() on it hits the native fast path, invokes ByteBlobLoader.toBufferedValue
// with store == null, and used to return an empty JSValue without throwing an
// exception — crashing the process (segfault in release, assertion in debug).
test("Response.body .blob() after Response.bytes() does not crash", async () => {
  const res = new Response("hello world");
  const body = res.body!;
  // Internally calls toBlobIfPossible which detaches the ByteBlobLoader store
  // but leaves the JS stream non-disturbed.
  res.bytes();
  // This previously crashed with "Expected an exception to be thrown" (or a
  // segfault in release). It should now return a promise that settles cleanly.
  const result = body.blob();
  expect(result).toBeInstanceOf(Promise);
  // Either resolves to a Blob or rejects with an error — either is acceptable.
  // The only unacceptable outcome is a native crash.
  await result.catch(() => {});
});

test("body.blob() after body then bytes returns a Blob-valued promise", async () => {
  const res = new Response("hello world");
  const body = res.body!;
  res.bytes();
  const blob = await body.blob();
  expect(blob).toBeInstanceOf(Blob);
});
