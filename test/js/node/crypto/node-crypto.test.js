import { it, expect, describe } from "bun:test";

import crypto from "node:crypto";
import { PassThrough, Readable } from "node:stream";

it("crypto.randomBytes should return a Buffer", () => {
  expect(crypto.randomBytes(1) instanceof Buffer).toBe(true);
  expect(Buffer.isBuffer(crypto.randomBytes(1))).toBe(true);
});

it("crypto.randomInt should return a number", () => {
  const result = crypto.randomInt(0, 10);
  expect(typeof result).toBe("number");
  expect(result).toBeGreaterThanOrEqual(0);
  expect(result).toBeLessThanOrEqual(10);
});

it("crypto.randomInt with no arguments", () => {
  const result = crypto.randomInt();
  expect(typeof result).toBe("number");
  expect(result).toBeGreaterThanOrEqual(0);
  expect(result).toBeLessThanOrEqual(Number.MAX_SAFE_INTEGER);
});

it("crypto.randomInt with one argument", () => {
  const result = crypto.randomInt(100);
  expect(typeof result).toBe("number");
  expect(result).toBeGreaterThanOrEqual(0);
  expect(result).toBeLessThanOrEqual(100);
});

// https://github.com/oven-sh/bun/issues/1839
describe("createHash", () => {
  it("update & digest", () => {
    const hash = crypto.createHash("sha256");
    hash.update("some data to hash");
    expect(hash.digest("hex")).toBe("6a2da20943931e9834fc12cfe5bb47bbd9ae43489a30726962b576f4e3993e50");
  });

  it("returns Buffer", () => {
    const hash = crypto.createHash("sha256");
    hash.update("some data to hash");
    expect(Buffer.isBuffer(hash.digest())).toBeTrue();
  });

  const otherEncodings = {
    ucs2: [
      11626, 2466, 37699, 38942, 64564, 53010, 48101, 47943, 44761, 18499, 12442, 26994, 46434, 62582, 39395, 20542,
    ],
    latin1: [
      106, 45, 162, 9, 67, 147, 30, 152, 52, 252, 18, 207, 229, 187, 71, 187, 217, 174, 67, 72, 154, 48, 114, 105, 98,
      181, 118, 244, 227, 153, 62, 80,
    ],
    binary: [
      106, 45, 162, 9, 67, 147, 30, 152, 52, 252, 18, 207, 229, 187, 71, 187, 217, 174, 67, 72, 154, 48, 114, 105, 98,
      181, 118, 244, 227, 153, 62, 80,
    ],
    base64: [
      97, 105, 50, 105, 67, 85, 79, 84, 72, 112, 103, 48, 47, 66, 76, 80, 53, 98, 116, 72, 117, 57, 109, 117, 81, 48,
      105, 97, 77, 72, 74, 112, 89, 114, 86, 50, 57, 79, 79, 90, 80, 108, 65, 61,
    ],
    base64url: [
      97, 105, 50, 105, 67, 85, 79, 84, 72, 112, 103, 48, 95, 66, 76, 80, 53, 98, 116, 72, 117, 57, 109, 117, 81, 48,
      105, 97, 77, 72, 74, 112, 89, 114, 86, 50, 57, 79, 79, 90, 80, 108, 65,
    ],
    hex: [
      54, 97, 50, 100, 97, 50, 48, 57, 52, 51, 57, 51, 49, 101, 57, 56, 51, 52, 102, 99, 49, 50, 99, 102, 101, 53, 98,
      98, 52, 55, 98, 98, 100, 57, 97, 101, 52, 51, 52, 56, 57, 97, 51, 48, 55, 50, 54, 57, 54, 50, 98, 53, 55, 54, 102,
      52, 101, 51, 57, 57, 51, 101, 53, 48,
    ],
    ascii: [
      106, 45, 34, 9, 67, 19, 30, 24, 52, 124, 18, 79, 101, 59, 71, 59, 89, 46, 67, 72, 26, 48, 114, 105, 98, 53, 118,
      116, 99, 25, 62, 80,
    ],
    utf8: [
      106, 45, 65533, 9, 67, 65533, 30, 65533, 52, 65533, 18, 65533, 65533, 71, 65533, 1646, 67, 72, 65533, 48, 114,
      105, 98, 65533, 118, 65533, 65533, 62, 80,
    ],
  };

  for (let encoding in otherEncodings) {
    it("digest " + encoding, () => {
      const hash = crypto.createHash("sha256");
      hash.update("some data to hash");
      expect(
        hash
          .digest(encoding)
          .split("")
          .map(a => a.charCodeAt(0)),
      ).toEqual(otherEncodings[encoding]);
    });
  }

  it("stream (sync)", () => {
    const hash = crypto.createHash("sha256");
    hash.write("some data to hash");
    hash.end();
    expect(hash.read().toString("hex")).toBe("6a2da20943931e9834fc12cfe5bb47bbd9ae43489a30726962b576f4e3993e50");
  });

  it("stream (async)", done => {
    const hash = crypto.createHash("sha256");
    hash.on("readable", () => {
      const data = hash.read();
      if (data) {
        expect(data.toString("hex")).toBe("6a2da20943931e9834fc12cfe5bb47bbd9ae43489a30726962b576f4e3993e50");
        done();
      }
    });
    hash.write("some data to hash");
    hash.end();
  });

  it("stream multiple chunks", done => {
    const hash = crypto.createHash("sha256");
    hash.write("some data to hash");
    hash.on("readable", () => {
      const data = hash.read();
      if (data) {
        expect(data.toString("hex")).toBe("43cc4cdc6bd7799b13da2d7c94bba96f3768bf7c4eba7038e0c393e4474fc9e5");
        done();
      }
    });
    hash.write("some data to hash");
    hash.write("some data to hash");
    hash.end();
  });

  it("stream with pipe", done => {
    const hash = crypto.createHash("sha256");
    const s = new PassThrough();

    hash.on("readable", () => {
      const data = hash.read();
      if (data) {
        expect(data.toString("hex")).toBe("0e1076315962f2e639ba2eea46223a813dafea530425613948c4b21635abd8fc");
        done();
      }
    });
    s.write("Hello world");
    s.pipe(hash);
    s.write("Bun!");
    s.end();
  });

  it("repeated calls doesnt segfault", () => {
    function fn() {
      crypto.createHash("sha1").update(Math.random(), "ascii").digest("base64");
    }

    for (let i = 0; i < 10; i++) fn();
  });

  it("multiple calls to digest throws exception", () => {
    const hash = crypto.createHash("sha256");
    hash.update("hello world");
    expect(hash.digest("hex")).toBe("b94d27b9934d3e08a52e52d7da7dabfac484efe37a5380ee9088f7ace2efcde9");
    expect(() => hash.digest("hex")).toThrow();
  });

  it("copy is the same", () => {
    const hash = crypto.createHash("sha256");
    hash.update("hello");
    const copy = hash.copy();

    expect(copy.digest("hex")).toBe(hash.digest("hex"));
  });

  it("copy is not linked", () => {
    const hash = crypto.createHash("sha256");
    hash.update("hello");
    const copy = hash.copy();

    hash.update("world");
    expect(copy.digest("hex")).not.toBe(hash.digest("hex"));
  });

  it("copy updates the same", () => {
    const hash = crypto.createHash("sha256");
    hash.update("hello");
    const copy = hash.copy();

    hash.update("world");
    copy.update("world");
    expect(copy.digest("hex")).toBe(hash.digest("hex"));
  });
});

it("crypto.createHmac", () => {
  const result = crypto.createHmac("sha256", "key").update("message").digest("base64");

  expect(result).toBe("bp7ym3X//Ft6uuUn1Y/a2y/kLnIZARl2kXNDBl9Y7Uo=");
});

it("web crypto", async () => {
  let bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  await crypto.subtle.digest("SHA-256", bytes);
});

// https://github.com/oven-sh/bun/issues/2110
it("hash regression #2110", () => {
  var s = "6fbf7e2948e0c2f29eaacac1733546a4af5ca482";
  expect(crypto.createHash("sha1").update(s, "binary").digest("hex")).toBe("e7c8b3c6f114c523d07ee355c534ee9bef3c044b");
});

// https://github.com/oven-sh/bun/issues/3680
it("createDecipheriv should validate iv and password", () => {
  const key = Buffer.alloc(16);

  expect(() => crypto.createDecipheriv("aes-128-ecb", key, undefined).setAutoPadding(false)).toThrow();
  expect(() => crypto.createDecipheriv("aes-128-ecb", key).setAutoPadding(false)).toThrow();
  expect(() => crypto.createDecipheriv("aes-128-ecb", key, null).setAutoPadding(false)).not.toThrow();
  expect(() =>
    crypto.createDecipheriv("aes-128-ecb", Buffer.from("Random", "utf8"), null).setAutoPadding(false),
  ).toThrow();
  expect(() => crypto.createDecipheriv("aes-128-ecb", key, Buffer.alloc(0)).setAutoPadding(false)).not.toThrow();

  expect(() => crypto.createDecipheriv("aes-128-cbc", key, undefined).setAutoPadding(false)).toThrow();
  expect(() => crypto.createDecipheriv("aes-128-cbc", key, null).setAutoPadding(false)).toThrow();
  expect(() => crypto.createDecipheriv("aes-128-cbc", key).setAutoPadding(false)).toThrow();
  expect(() => crypto.createDecipheriv("aes-128-cbc", key, Buffer.alloc(16)).setAutoPadding(false)).not.toThrow();
});
