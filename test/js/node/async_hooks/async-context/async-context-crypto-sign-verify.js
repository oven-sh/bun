process.exitCode = 1;
const { AsyncLocalStorage } = require("async_hooks");
const crypto = require("crypto");

const asyncLocalStorage = new AsyncLocalStorage();
let failed = false;

// First generate a key pair synchronously
const { publicKey, privateKey } = crypto.generateKeyPairSync("rsa", {
  modulusLength: 512,
});

asyncLocalStorage.run({ test: "crypto.sign/verify" }, () => {
  // Test sign with stream
  const sign = crypto.createSign("SHA256");
  sign.write("test data");
  sign.end();

  const signature = sign.sign(privateKey);

  // Test verify with stream
  const verify = crypto.createVerify("SHA256");
  verify.write("test data");
  verify.end();

  setImmediate(() => {
    if (asyncLocalStorage.getStore()?.test !== "crypto.sign/verify") {
      console.error("FAIL: crypto sign/verify lost context");
      failed = true;
    }

    const isValid = verify.verify(publicKey, signature);
    process.exit(failed ? 1 : 0);
  });
});
