async function doTest(additionalData) {
  const name = "AES-GCM";
  const key = await crypto.subtle.generateKey({ name, length: 128 }, false, ["encrypt", "decrypt"]);
  const plaintext = new Uint8Array();
  const iv = crypto.getRandomValues(new Uint8Array(16));
  const algorithm = { name, iv, tagLength: 128, additionalData };
  const ciphertext = await crypto.subtle.encrypt(algorithm, key, plaintext);
  const decrypted = await crypto.subtle.decrypt(algorithm, key, ciphertext);
  expect(new TextDecoder().decode(decrypted)).toBe("");
}

it("crypto.subtle.encrypt AES-GCM empty data", async () => {
  doTest(undefined);
});

it("crypto.subtle.encrypt AES-GCM empty data with additional associated data", async () => {
  doTest(crypto.getRandomValues(new Uint8Array(16)));
});
