import { describe, expect, test } from "bun:test";

// When an S3 operation throws after the temporary blob store has taken
// ownership of the path, the caller's errdefer must not deref the path a
// second time. Previously this asserted in debug builds (string refcount
// underflow) when presign threw synchronously.
describe("S3 path ownership on error", () => {
  // use an options value that makes getPresignUrlFrom throw synchronously
  // regardless of any ambient AWS credentials in the environment.
  const badOptions = { expiresIn: -1, accessKeyId: "x", secretAccessKey: "y" };

  test("S3Client.presign (static)", () => {
    // use a fresh non-interned string so the refcount starts at 1
    const path = ["some", "path", Math.random()].join("-");
    expect(() => Bun.S3Client.presign(path, badOptions)).toThrow();
    Bun.gc(true);
  });

  test("S3Client#presign (instance)", () => {
    const client = new Bun.S3Client({});
    const path = ["some", "path", Math.random()].join("-");
    expect(() => client.presign(path, badOptions)).toThrow();
    Bun.gc(true);
  });
});
