import { describe, expect, test } from "bun:test";
import { Hash, createHash, createHmac } from "crypto";
import { once } from "events";
import { Readable, Transform } from "stream";
import { pipeline } from "stream/promises";

describe("LazyHash quirks", () => {
  test("hash instanceof Transform", () => {
    const hash = createHash("sha256");
    expect(hash instanceof Transform).toBe(true);
  });
  test("Hash.prototype instanceof Transform", () => {
    expect(Hash.prototype instanceof Transform).toBe(true);
  });
});

describe.each([
  ["Hash", () => createHash("sha256")],
  ["Hmac", () => createHmac("sha256", "key")],
])("%s stream after digest()", (_, make) => {
  test("write() does not throw synchronously; error goes to callback and 'error'", async () => {
    const h = make();
    h.update("x");
    h.digest("hex");

    const errorEvent = once(h, "error");
    let cbErr: unknown = "not-called";
    let threw: unknown = null;
    let ret: unknown;
    try {
      ret = h.write("late", (err?: unknown) => {
        cbErr = err;
      });
    } catch (err) {
      threw = err;
    }

    expect(threw).toBeNull();
    expect(ret).toBe(false);

    const [emitted] = await errorEvent;
    expect((emitted as NodeJS.ErrnoException).code).toBe("ERR_CRYPTO_HASH_FINALIZED");
    expect((cbErr as NodeJS.ErrnoException)?.code).toBe("ERR_CRYPTO_HASH_FINALIZED");
  });

  test("end() does not throw synchronously; error goes to 'error'", async () => {
    const h = make();
    h.update("x");
    h.digest("hex");

    const errorEvent = once(h, "error");
    let threw: unknown = null;
    try {
      h.end("late");
    } catch (err) {
      threw = err;
    }

    expect(threw).toBeNull();
    const [emitted] = await errorEvent;
    expect((emitted as NodeJS.ErrnoException).code).toBe("ERR_CRYPTO_HASH_FINALIZED");
  });

  test("pipeline into finalized stream rejects with ERR_CRYPTO_HASH_FINALIZED", async () => {
    const h = make();
    h.update("x");
    h.digest("hex");

    await expect(pipeline(Readable.from([Buffer.from("late")]), h)).rejects.toMatchObject({
      code: "ERR_CRYPTO_HASH_FINALIZED",
    });
  });

  test("direct update() after digest() still throws synchronously", () => {
    const h = make();
    h.update("x");
    h.digest("hex");
    let code: unknown = null;
    try {
      h.update("late");
    } catch (e) {
      code = (e as NodeJS.ErrnoException).code;
    }
    expect(code).toBe("ERR_CRYPTO_HASH_FINALIZED");
  });
});
