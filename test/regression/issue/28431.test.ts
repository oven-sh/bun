// Ensure this test runs in both Node.js & Bun to verify compatibility.
import assert from "node:assert";
import { Readable, Transform } from "node:stream";
import { test } from "node:test";

test("piping object-mode source into byte-mode destination emits catchable error", async () => {
  const objectReadable = Readable.from([{ hello: "world" }]);

  const passThrough = new Transform({
    objectMode: false,
    transform(chunk, _encoding, cb) {
      this.push(chunk);
      cb();
    },
  });

  const errors: Error[] = [];

  passThrough.on("error", err => {
    errors.push(err);
  });

  objectReadable.pipe(passThrough);

  let caughtError: Error | undefined;
  try {
    for await (const _v of passThrough) {
      // should not receive any data
    }
  } catch (e: any) {
    caughtError = e;
  }

  assert.ok(caughtError);
  assert.strictEqual((caughtError as any).code, "ERR_INVALID_ARG_TYPE");

  assert.strictEqual(errors.length, 1);
  assert.strictEqual((errors[0] as any).code, "ERR_INVALID_ARG_TYPE");
});
