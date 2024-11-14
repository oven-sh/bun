//#FILE: test-crypto-webcrypto-aes-decrypt-tag-too-small.js
//#SHA1: e58d2e4e7dcfc3a29a6e9acbe177f32a1d6bf280
//-----------------
"use strict";

if (!globalThis.crypto?.subtle) {
  test.skip("missing crypto");
}

test("AES-GCM decrypt with tag too small", async () => {
  const { subtle } = globalThis.crypto;

  const key = await subtle.importKey(
    "raw",
    new Uint8Array(32),
    {
      name: "AES-GCM",
    },
    false,
    ["encrypt", "decrypt"],
  );

  await expect(
    subtle.decrypt(
      {
        name: "AES-GCM",
        iv: new Uint8Array(12),
      },
      key,
      new Uint8Array(0),
    ),
  ).rejects.toThrow(
    expect.objectContaining({
      name: "OperationError",
      message: expect.any(String),
    }),
  );
});

//<#END_FILE: test-crypto-webcrypto-aes-decrypt-tag-too-small.js
