import { expect, test } from "bun:test";
import { Readable, Transform } from "node:stream";

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

  expect(caughtError).toBeDefined();
  expect((caughtError as any).code).toBe("ERR_INVALID_ARG_TYPE");

  expect(errors.length).toBe(1);
  expect((errors[0] as any).code).toBe("ERR_INVALID_ARG_TYPE");
});
