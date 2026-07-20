import { describe, expect, it } from "bun:test";
import { createHash, createHmac, getHashes, pbkdf2Sync } from "node:crypto";

const hex = (buf: ArrayBuffer) => [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, "0")).join("");

// NIST FIPS 202 test vectors
const vectors = [
  ["SHA3-256", "", "a7ffc6f8bf1ed76651c14756a061d662f580ff4de43b49fa82d80a4b80f8434a"],
  ["SHA3-256", "abc", "3a985da74fe225b2045c172d6bd390bd855f086e3e9d525b46bfe24511431532"],
  ["SHA3-384", "", "0c63a75b845e4f7d01107d852e4c2485c51a50aaaa94fc61995e71bbee983a2ac3713831264adb47fb6bd1e058d5f004"],
  [
    "SHA3-384",
    "abc",
    "ec01498288516fc926459f58e2c6ad8df9b473cb0fc08c2596da7cf0e49be4b298d88cea927ac7f539f1edf228376d25",
  ],
  [
    "SHA3-512",
    "",
    "a69f73cca23a9ac5c8b567dc185a756e97c982164fe25859e0d1dcc1475c80a615b2123af1f5f94c11e3e9402c3ac558f500199d95b6d3e301758586281dcd26",
  ],
  [
    "SHA3-512",
    "abc",
    "b751850b1a57168a5693cd924b6b096e08f621827444f70d884f5d0240d2712e10e116e9192af3c91a7ec57647e3934057340b4cf408d5a56592f8274eec53f0",
  ],
] as const;

describe("crypto.subtle.digest SHA-3", () => {
  for (const [alg, input, expected] of vectors) {
    it(`${alg}(${JSON.stringify(input)})`, async () => {
      const buf = await crypto.subtle.digest(alg, new TextEncoder().encode(input));
      expect(hex(buf)).toBe(expected);
    });
  }

  it("SHA3-256 large input (>64 bytes, async path)", async () => {
    const input = Buffer.alloc(1_000_000, "a");
    const buf = await crypto.subtle.digest("SHA3-256", input);
    expect(hex(buf)).toBe("5c8875ae474a3634ba4fd55ec85bffd661f32aca75c6d699d0cdcb6c115891c1");
  });

  it("rejects unknown digest", async () => {
    await expect(crypto.subtle.digest("SHA3-1024" as any, new Uint8Array())).rejects.toThrow();
  });
});

describe("HMAC with SHA-3", () => {
  it("generateKey + sign + verify with SHA3-256", async () => {
    const key = await crypto.subtle.generateKey({ name: "HMAC", hash: "SHA3-256" }, true, ["sign", "verify"]);
    const data = new TextEncoder().encode("hello world");
    const sig = await crypto.subtle.sign("HMAC", key, data);
    expect(sig.byteLength).toBe(32);
    expect(await crypto.subtle.verify("HMAC", key, sig, data)).toBe(true);

    const tampered = new Uint8Array(sig);
    tampered[0] ^= 0xff;
    expect(await crypto.subtle.verify("HMAC", key, tampered, data)).toBe(false);
  });

  it("HMAC-SHA3-256 against NIST vector", async () => {
    const keyBytes = new Uint8Array(32).map((_, i) => i);
    const key = await crypto.subtle.importKey("raw", keyBytes, { name: "HMAC", hash: "SHA3-256" }, false, ["sign"]);
    const msg = new TextEncoder().encode("Sample message for keylen<blocklen");
    const sig = await crypto.subtle.sign("HMAC", key, msg);
    expect(hex(sig)).toBe("4fe8e202c4f058e8dddc23d8c34e467343e23555e24fc2f025d598f558f67205");
  });

  it("HMAC-SHA3-384 generateKey default length", async () => {
    const key = await crypto.subtle.generateKey({ name: "HMAC", hash: "SHA3-384" }, true, ["sign"]);
    const raw = await crypto.subtle.exportKey("raw", key);
    expect(raw.byteLength).toBe(104);
  });
});

describe("RSA with SHA-3 hash", () => {
  it("RSA-PSS with SHA3-256: generate, sign, verify, JWK export", async () => {
    const { publicKey, privateKey } = await crypto.subtle.generateKey(
      {
        name: "RSA-PSS",
        modulusLength: 2048,
        publicExponent: new Uint8Array([1, 0, 1]),
        hash: "SHA3-256",
      },
      true,
      ["sign", "verify"],
    );
    const data = new TextEncoder().encode("hello");
    const sig = await crypto.subtle.sign({ name: "RSA-PSS", saltLength: 32 }, privateKey, data);
    expect(await crypto.subtle.verify({ name: "RSA-PSS", saltLength: 32 }, publicKey, sig, data)).toBe(true);

    const jwk = await crypto.subtle.exportKey("jwk", publicKey);
    expect(jwk.kty).toBe("RSA");
    expect(jwk.alg).toBeUndefined();

    const reimported = await crypto.subtle.importKey("jwk", jwk, { name: "RSA-PSS", hash: "SHA3-256" }, true, [
      "verify",
    ]);
    expect(await crypto.subtle.verify({ name: "RSA-PSS", saltLength: 32 }, reimported, sig, data)).toBe(true);
  });
});

describe("node:crypto SHA-3", () => {
  it("createHash sha3-256", () => {
    expect(createHash("sha3-256").update("abc").digest("hex")).toBe(
      "3a985da74fe225b2045c172d6bd390bd855f086e3e9d525b46bfe24511431532",
    );
  });

  it("createHash sha3-384", () => {
    expect(createHash("sha3-384").update("abc").digest("hex")).toBe(
      "ec01498288516fc926459f58e2c6ad8df9b473cb0fc08c2596da7cf0e49be4b298d88cea927ac7f539f1edf228376d25",
    );
  });

  it("createHmac sha3-512", () => {
    expect(createHmac("sha3-512", Buffer.from("key")).update("data").digest("hex")).toBe(
      "752bf49d54115aaa670ea62bdf79eb95e6df787938bec5fabdfc4745cf49f7fe11b7c2f73989ad2e568f06ced3a2d99536b05a121f43647b98ea43f818f38b33",
    );
  });

  it("getHashes includes sha3", () => {
    const hashes = getHashes();
    expect(hashes).toContain("sha3-256");
    expect(hashes).toContain("sha3-384");
    expect(hashes).toContain("sha3-512");
  });

  it("pbkdf2Sync sha3-256", () => {
    expect(pbkdf2Sync("pw", "salt", 1000, 32, "sha3-256").toString("hex")).toBe(
      "53b1bc246a311cbf8e2c907d96bcb209ddf95cd9f0a74fdcbab033b6ea82e30a",
    );
  });
});
