import { describe, expect, it } from "bun:test";

import crypto from "node:crypto";
import { PassThrough, Readable } from "node:stream";
import util from "node:util";

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
  expect(() => crypto.randomInt()).toThrow(TypeError);
});

it("crypto.randomInt with one argument", () => {
  const result = crypto.randomInt(100);
  expect(typeof result).toBe("number");
  expect(result).toBeGreaterThanOrEqual(0);
  expect(result).toBeLessThanOrEqual(100);
});

it("crypto.randomInt with a callback", async () => {
  const result = await util.promisify(crypto.randomInt)(0, 10);
  expect(typeof result).toBe("number");
  expect(result).toBeGreaterThanOrEqual(0);
  expect(result).toBeLessThanOrEqual(10);
});

// https://github.com/oven-sh/bun/issues/1839
describe("createHash", () => {
  const nodeValues = {
    "RSA-MD5": {
      "value": "b10a8db164e0754105b7a99be72e3fe5",
      "input": "Hello World",
    },
    "RSA-RIPEMD160": {
      "value": "a830d7beb04eb7549ce990fb7dc962e499a27230",
      "input": "Hello World",
    },
    "RSA-SHA1": {
      "value": "0a4d55a8d778e5022fab701977c5d840bbc486d0",
      "input": "Hello World",
    },
    "RSA-SHA1-2": {
      "value": "0a4d55a8d778e5022fab701977c5d840bbc486d0",
      "input": "Hello World",
    },
    "RSA-SHA224": {
      "value": "c4890faffdb0105d991a461e668e276685401b02eab1ef4372795047",
      "input": "Hello World",
    },
    "RSA-SHA256": {
      "value": "a591a6d40bf420404a011733cfb7b190d62c65bf0bcda32b57b277d9ad9f146e",
      "input": "Hello World",
    },
    "RSA-SHA3-224": {
      "value": "8e800079a0b311788bf29353f400eff969b650a3597c91efd9aa5b38",
      "input": "Hello World",
    },
    "RSA-SHA3-256": {
      "value": "e167f68d6563d75bb25f3aa49c29ef612d41352dc00606de7cbd630bb2665f51",
      "input": "Hello World",
    },
    "RSA-SHA3-384": {
      "value": "a78ec2851e991638ce505d4a44efa606dd4056d3ab274ec6fdbac00cde16478263ef7213bad5a7db7044f58d637afdeb",
      "input": "Hello World",
    },
    "RSA-SHA3-512": {
      "value":
        "3d58a719c6866b0214f96b0a67b37e51a91e233ce0be126a08f35fdf4c043c6126f40139bfbc338d44eb2a03de9f7bb8eff0ac260b3629811e389a5fbee8a894",
      "input": "Hello World",
    },
    "RSA-SHA384": {
      "value": "99514329186b2f6ae4a1329e7ee6c610a729636335174ac6b740f9028396fcc803d0e93863a7c3d90f86beee782f4f3f",
      "input": "Hello World",
    },
    "RSA-SHA512": {
      "value":
        "2c74fd17edafd80e8447b0d46741ee243b7eb74dd2149a0ab1b9246fb30382f27e853d8585719e0e67cbda0daa8f51671064615d645ae27acb15bfb1447f459b",
      "input": "Hello World",
    },
    "RSA-SHA512/224": {
      "value": "feca41095c80a571ae782f96bcef9ab81bdf0182509a6844f32c4c17",
      "input": "Hello World",
    },
    "RSA-SHA512/256": {
      "value": "ff20018851481c25bfc2e5d0c1e1fa57dac2a237a1a96192f99a10da47aa5442",
      "input": "Hello World",
    },
    "RSA-SM3": {
      "value": "77015816143ee627f4fa410b6dad2bdb9fcbdf1e061a452a686b8711a484c5d7",
      "input": "Hello World",
    },
    "blake2b512": {
      "value":
        "4386a08a265111c9896f56456e2cb61a64239115c4784cf438e36cc851221972da3fb0115f73cd02486254001f878ab1fd126aac69844ef1c1ca152379d0a9bd",
      "input": "Hello World",
    },
    "blake2s256": {
      "value": "7706af019148849e516f95ba630307a2018bb7bf03803eca5ed7ed2c3c013513",
      "input": "Hello World",
    },
    "id-rsassa-pkcs1-v1_5-with-sha3-224": {
      "value": "8e800079a0b311788bf29353f400eff969b650a3597c91efd9aa5b38",
      "input": "Hello World",
    },
    "id-rsassa-pkcs1-v1_5-with-sha3-256": {
      "value": "e167f68d6563d75bb25f3aa49c29ef612d41352dc00606de7cbd630bb2665f51",
      "input": "Hello World",
    },
    "id-rsassa-pkcs1-v1_5-with-sha3-384": {
      "value": "a78ec2851e991638ce505d4a44efa606dd4056d3ab274ec6fdbac00cde16478263ef7213bad5a7db7044f58d637afdeb",
      "input": "Hello World",
    },
    "id-rsassa-pkcs1-v1_5-with-sha3-512": {
      "value":
        "3d58a719c6866b0214f96b0a67b37e51a91e233ce0be126a08f35fdf4c043c6126f40139bfbc338d44eb2a03de9f7bb8eff0ac260b3629811e389a5fbee8a894",
      "input": "Hello World",
    },
    "md5": {
      "value": "b10a8db164e0754105b7a99be72e3fe5",
      "input": "Hello World",
    },
    "md5-sha1": {
      "value": "b10a8db164e0754105b7a99be72e3fe50a4d55a8d778e5022fab701977c5d840bbc486d0",
      "input": "Hello World",
    },
    "md5WithRSAEncryption": {
      "value": "b10a8db164e0754105b7a99be72e3fe5",
      "input": "Hello World",
    },
    "ripemd": {
      "value": "a830d7beb04eb7549ce990fb7dc962e499a27230",
      "input": "Hello World",
    },
    "ripemd160": {
      "value": "a830d7beb04eb7549ce990fb7dc962e499a27230",
      "input": "Hello World",
    },
    "ripemd160WithRSA": {
      "value": "a830d7beb04eb7549ce990fb7dc962e499a27230",
      "input": "Hello World",
    },
    "rmd160": {
      "value": "a830d7beb04eb7549ce990fb7dc962e499a27230",
      "input": "Hello World",
    },
    "sha1": {
      "value": "0a4d55a8d778e5022fab701977c5d840bbc486d0",
      "input": "Hello World",
    },
    "sha1WithRSAEncryption": {
      "value": "0a4d55a8d778e5022fab701977c5d840bbc486d0",
      "input": "Hello World",
    },
    "sha224": {
      "value": "c4890faffdb0105d991a461e668e276685401b02eab1ef4372795047",
      "input": "Hello World",
    },
    "sha224WithRSAEncryption": {
      "value": "c4890faffdb0105d991a461e668e276685401b02eab1ef4372795047",
      "input": "Hello World",
    },
    "sha256": {
      "value": "a591a6d40bf420404a011733cfb7b190d62c65bf0bcda32b57b277d9ad9f146e",
      "input": "Hello World",
    },
    "sha256WithRSAEncryption": {
      "value": "a591a6d40bf420404a011733cfb7b190d62c65bf0bcda32b57b277d9ad9f146e",
      "input": "Hello World",
    },
    "sha3-224": {
      "value": "8e800079a0b311788bf29353f400eff969b650a3597c91efd9aa5b38",
      "input": "Hello World",
    },
    "sha3-256": {
      "value": "e167f68d6563d75bb25f3aa49c29ef612d41352dc00606de7cbd630bb2665f51",
      "input": "Hello World",
    },
    "sha3-384": {
      "value": "a78ec2851e991638ce505d4a44efa606dd4056d3ab274ec6fdbac00cde16478263ef7213bad5a7db7044f58d637afdeb",
      "input": "Hello World",
    },
    "sha3-512": {
      "value":
        "3d58a719c6866b0214f96b0a67b37e51a91e233ce0be126a08f35fdf4c043c6126f40139bfbc338d44eb2a03de9f7bb8eff0ac260b3629811e389a5fbee8a894",
      "input": "Hello World",
    },
    "sha384": {
      "value": "99514329186b2f6ae4a1329e7ee6c610a729636335174ac6b740f9028396fcc803d0e93863a7c3d90f86beee782f4f3f",
      "input": "Hello World",
    },
    "sha384WithRSAEncryption": {
      "value": "99514329186b2f6ae4a1329e7ee6c610a729636335174ac6b740f9028396fcc803d0e93863a7c3d90f86beee782f4f3f",
      "input": "Hello World",
    },
    "sha512": {
      "value":
        "2c74fd17edafd80e8447b0d46741ee243b7eb74dd2149a0ab1b9246fb30382f27e853d8585719e0e67cbda0daa8f51671064615d645ae27acb15bfb1447f459b",
      "input": "Hello World",
    },
    "sha512-224": {
      "value": "feca41095c80a571ae782f96bcef9ab81bdf0182509a6844f32c4c17",
      "input": "Hello World",
    },
    "sha512-224WithRSAEncryption": {
      "value": "feca41095c80a571ae782f96bcef9ab81bdf0182509a6844f32c4c17",
      "input": "Hello World",
    },
    "sha512-256": {
      "value": "ff20018851481c25bfc2e5d0c1e1fa57dac2a237a1a96192f99a10da47aa5442",
      "input": "Hello World",
    },
    "sha512-256WithRSAEncryption": {
      "value": "ff20018851481c25bfc2e5d0c1e1fa57dac2a237a1a96192f99a10da47aa5442",
      "input": "Hello World",
    },
    "sha512WithRSAEncryption": {
      "value":
        "2c74fd17edafd80e8447b0d46741ee243b7eb74dd2149a0ab1b9246fb30382f27e853d8585719e0e67cbda0daa8f51671064615d645ae27acb15bfb1447f459b",
      "input": "Hello World",
    },
    "shake128": {
      "value": "1227c5f882f9c57bf2e3e48d2c87eb20",
      "input": "Hello World",
    },
    "shake256": {
      "value": "840d1ce81a4327840b54cb1d419907fd1f62359bad33656e058653d2e4172a43",
      "input": "Hello World",
    },
    "sm3": {
      "value": "77015816143ee627f4fa410b6dad2bdb9fcbdf1e061a452a686b8711a484c5d7",
      "input": "Hello World",
    },
    "sm3WithRSAEncryption": {
      "value": "77015816143ee627f4fa410b6dad2bdb9fcbdf1e061a452a686b8711a484c5d7",
      "input": "Hello World",
    },
    "ssl3-md5": {
      "value": "b10a8db164e0754105b7a99be72e3fe5",
      "input": "Hello World",
    },
    "ssl3-sha1": {
      "value": "0a4d55a8d778e5022fab701977c5d840bbc486d0",
      "input": "Hello World",
    },
  };

  const unsupported = [
    "blake2s256",
    "id-rsassa-pkcs1-v1_5-with-sha3-224",
    "id-rsassa-pkcs1-v1_5-with-sha3-256",
    "id-rsassa-pkcs1-v1_5-with-sha3-384",
    "id-rsassa-pkcs1-v1_5-with-sha3-512",
    "md5withrsaencryption",
    "ripemd",
    "ripemd160withrsa",
    "rsa-md5",
    "rsa-ripemd160",
    "rsa-sha1",
    "rsa-sha1-2",
    "rsa-sha224",
    "rsa-sha256",
    "rsa-sha3-224",
    "rsa-sha3-256",
    "rsa-sha3-384",
    "rsa-sha3-512",
    "rsa-sha384",
    "rsa-sha512",
    "rsa-sha512/224",
    "rsa-sha512/256",
    "rsa-sm3",
    "sha1withrsaencryption",
    "sha224withrsaencryption",
    "sha256withrsaencryption",
    "sha384withrsaencryption",
    "sha512withrsaencryption",
    "sha512-224withrsaencryption",
    "sha512-256withrsaencryption",
    "sm3",
    "sm3withrsaencryption",
    "ssl3-md5",
    "ssl3-sha1",
  ];

  for (const name_ in nodeValues) {
    const name = name_.toLowerCase();
    const is_unsupported = unsupported.includes(name);

    it(`${name} - "Hello World"`, () => {
      if (is_unsupported) {
        expect(() => {
          const hash = crypto.createHash(name);
          hash.update("Hello World");
          expect(hash.digest("hex")).toBe(nodeValues[name].value);
        }).toThrow(Error(`Digest method not supported`));
      } else {
        const hash = crypto.createHash(name);
        hash.update("Hello World");

        // testing copy to be sure boringssl workarounds for blake2b256/512,
        // ripemd160, sha3-<n>, and shake128/256 are working.
        const copy = hash.copy();
        expect(hash.digest("hex")).toBe(nodeValues[name].value);
        expect(copy.digest("hex")).toBe(nodeValues[name].value);

        expect(() => {
          hash.copy();
        }).toThrow(Error(`Digest already called`));
        expect(() => {
          copy.copy();
        }).toThrow(Error(`Digest already called`));
      }
    });

    it(`${name} - "Hello World" -> binary`, () => {
      if (is_unsupported) {
        expect(() => {
          const hash = crypto.createHash(name);
          hash.update("Hello World");
          expect(hash.digest()).toEqual(Buffer.from(nodeValues[name].value, "hex"));
        }).toThrow(Error(`Digest method not supported`));
      } else {
        const hash = crypto.createHash(name);
        hash.update("Hello World");
        expect(hash.digest()).toEqual(Buffer.from(nodeValues[name].value, "hex"));
      }
    });
  }

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
      crypto.createHash("sha1").update(Math.random().toString(), "ascii").digest("base64");
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

  it("uses the Transform options object", () => {
    const hasher = crypto.createHash("sha256", { defaultEncoding: "binary" });
    hasher.on("readable", () => {
      const data = hasher.read();
      if (data) {
        expect(data.toString("hex")).toBe("4d4d75d742863ab9656f3d5f76dff8589c3922e95a24ea6812157ffe4aaa3b6b");
      }
    });
    const stream = Readable.from("ï");
    stream.pipe(hasher);
  });
});

describe("Hash", () => {
  it("should have correct method names", () => {
    const hash = crypto.createHash("sha256");
    expect(hash.update.name).toBe("update");
    expect(hash.digest.name).toBe("digest");
    expect(hash.copy.name).toBe("copy");
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

it("Cipheriv.update throws expected error for invalid data", () => {
  const key = crypto.randomBytes(32);
  const iv = crypto.randomBytes(16);
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
  expect(() => {
    cipher.update(["c", "d"]);
  }).toThrow(
    'The "data" argument must be of type string or an instance of Buffer, TypedArray, or DataView. Received an instance of Array',
  );
});

it("verifyOneShot should not accept strings for signatures", () => {
  const data = Buffer.alloc(1);
  expect(() => {
    crypto.verify(null, data, "test", "oops");
  }).toThrow(
    "The \"signature\" argument must be an instance of Buffer, TypedArray, or DataView. Received type string ('oops')",
  );
});

it("x25519", () => {
  // Generate Alice's keys
  const alice = crypto.generateKeyPairSync("x25519", {
    publicKeyEncoding: {
      type: "spki",
      format: "der",
    },
    privateKeyEncoding: {
      type: "pkcs8",
      format: "der",
    },
  });

  // Generate Bob's keys
  const bob = crypto.generateKeyPairSync("x25519", {
    publicKeyEncoding: {
      type: "spki",
      format: "der",
    },
    privateKeyEncoding: {
      type: "pkcs8",
      format: "der",
    },
  });

  // Convert keys to KeyObjects before DH computation
  const alicePrivateKey = crypto.createPrivateKey({
    key: alice.privateKey,
    format: "der",
    type: "pkcs8",
  });

  const bobPublicKey = crypto.createPublicKey({
    key: bob.publicKey,
    format: "der",
    type: "spki",
  });

  const bobPrivateKey = crypto.createPrivateKey({
    key: bob.privateKey,
    format: "der",
    type: "pkcs8",
  });

  const alicePublicKey = crypto.createPublicKey({
    key: alice.publicKey,
    format: "der",
    type: "spki",
  });

  // Compute shared secrets using KeyObjects
  const aliceSecret = crypto.diffieHellman({
    privateKey: alicePrivateKey,
    publicKey: bobPublicKey,
  });

  const bobSecret = crypto.diffieHellman({
    privateKey: bobPrivateKey,
    publicKey: alicePublicKey,
  });

  // Verify both parties computed the same secret
  expect(aliceSecret).toEqual(bobSecret);
  expect(aliceSecret.length).toBe(32);

  // Verify valid key generation
  expect(() => {
    crypto.generateKeyPairSync("x25519", {
      publicKeyEncoding: {
        type: "spki",
        format: "der",
      },
      privateKeyEncoding: {
        type: "pkcs8",
        format: "der",
      },
    });
  }).not.toThrow();

  // Test invalid keys - need to create proper KeyObjects even for invalid cases
  expect(() => {
    crypto.diffieHellman({
      privateKey: crypto.createPrivateKey({
        key: Buffer.from("invalid"),
        format: "der",
        type: "pkcs8",
      }),
      publicKey: bobPublicKey,
    });
  }).toThrow();

  expect(() => {
    crypto.diffieHellman({
      privateKey: bobPrivateKey,
      publicKey: crypto.createPublicKey({
        key: Buffer.from("invalid"),
        format: "der",
        type: "spki",
      }),
    });
  }).toThrow();
});

it("encoding should not throw in null, undefined or in valid encodings in createHmac #18700", () => {
  for (let encoding of [undefined, null, "utf8", "utf-8", "ascii", "binary", "hex", "base64", "base64url"]) {
    const hmac = crypto.createHmac("sha256", "a secret", { encoding });

    hmac.update("some data to hash");
    expect(hmac.digest("hex")?.length).toBe(64);
  }
});

it("verifyError should not be on the prototype of DiffieHellman and DiffieHellmanGroup", () => {
  const dh = crypto.createDiffieHellman(512);
  expect("verifyError" in crypto.DiffieHellman.prototype).toBeFalse();
  expect("verifyError" in dh).toBeTrue();
  expect(dh.verifyError).toBe(0);

  const dhg = crypto.createDiffieHellmanGroup("modp5");
  expect("verifyError" in crypto.DiffieHellmanGroup.prototype).toBeFalse();
  expect("verifyError" in dhg).toBeTrue();

  // boringssl seems to set DH_NOT_SUITABLE_GENERATOR for both
  // DH_GENERATOR_2 and DH_GENERATOR_5 if not using
  // DH_generate_parameters_ex
  expect(dhg.verifyError).toBe(8);
});
