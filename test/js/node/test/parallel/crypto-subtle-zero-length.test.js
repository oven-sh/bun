//#FILE: test-crypto-subtle-zero-length.js
//#SHA1: aa21bbc5fd9db7bc09dad3ec61cd743d655f5e3b
//-----------------
"use strict";

// Skip test if crypto is not available
if (typeof crypto === "undefined" || !crypto.subtle) {
  test.skip("missing crypto");
}

test("SubtleCrypto with zero-length input", async () => {
  const { subtle } = globalThis.crypto;

  const k = await subtle.importKey("raw", new Uint8Array(32), { name: "AES-GCM" }, false, ["encrypt", "decrypt"]);
  expect(k).toBeInstanceOf(CryptoKey);

  const e = await subtle.encrypt(
    {
      name: "AES-GCM",
      iv: new Uint8Array(12),
    },
    k,
    new Uint8Array(0),
  );
  expect(e).toBeInstanceOf(ArrayBuffer);
  expect(Buffer.from(e)).toEqual(
    Buffer.from([0x53, 0x0f, 0x8a, 0xfb, 0xc7, 0x45, 0x36, 0xb9, 0xa9, 0x63, 0xb4, 0xf1, 0xc4, 0xcb, 0x73, 0x8b]),
  );

  const v = await subtle.decrypt(
    {
      name: "AES-GCM",
      iv: new Uint8Array(12),
    },
    k,
    e,
  );
  expect(v).toBeInstanceOf(ArrayBuffer);
  expect(v.byteLength).toBe(0);
});

//<#END_FILE: test-crypto-subtle-zero-length.js
