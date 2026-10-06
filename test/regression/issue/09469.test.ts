const crypto = require("crypto");
const util = require("util");

if (!crypto.generateKeyPair) {
  test.skip("missing crypto.generateKeyPair");
}

test("09469", async () => {
  const generateKeyPairAsync = util.promisify(crypto.generateKeyPair);
  const ret = await generateKeyPairAsync("rsa", {
    publicExponent: 3,
    modulusLength: 512,
    publicKeyEncoding: {
      type: "pkcs1",
      format: "pem",
    },
    privateKeyEncoding: {
      type: "pkcs8",
      format: "pem",
    },
  });

  expect(Object.keys(ret)).toHaveLength(2);
  const { publicKey, privateKey } = ret;
  expect(typeof publicKey).toBe("string");
  expect(typeof privateKey).toBe("string");
});
