import { expect, test } from "bun:test";
import { tmpdirSync } from "harness";
import { join } from "path";

// Writing a non-BlobPart value (e.g. a native constructor) to Bun.write goes
// through Blob.get -> JSValue.toSlice -> String.fromJS. This test guards
// against a debug assertion in String.fromJS when toWTFString returns a null
// WTF::String without a pending JSC exception. The assertion manifested as
// "reached unreachable code" under the fuzzer (fingerprint 16d4efee8ad02d3d).
test("Bun.write stringifies non-BlobPart objects without asserting", async () => {
  const dir = tmpdirSync();
  const dst = join(dir, "out.txt");

  for (let i = 0; i < 32; i++) {
    await Bun.write(dst, ArrayBuffer);
    Bun.gc(true);
  }

  const text = await Bun.file(dst).text();
  expect(text).toBe(String(ArrayBuffer));
});

test("S3Client.write stringifies non-BlobPart objects without asserting", () => {
  const client = new Bun.S3Client();
  for (const value of [ArrayBuffer, Float64Array, Object, function () {}]) {
    // The write should synchronously build the source Blob (exercising
    // String.fromJS on the value) and then reject due to missing credentials.
    expect(client.write("key", value)).rejects.toThrow();
    Bun.gc(true);
  }
});
