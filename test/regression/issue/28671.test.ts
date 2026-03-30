import { expect, test } from "bun:test";
import { bunEnv, bunExe } from "harness";

const ciphersToTest = [
  "aes-128-ecb",
  "aes-192-ecb",
  "aes-256-ecb",
  "aes-128-cbc",
  "aes-192-cbc",
  "aes-256-cbc",
  "aes-128-ofb",
  "aes-192-ofb",
  "aes-256-ofb",
  "aes-128-cfb",
  "aes-256-cfb",
  "des-cbc",
  "des-ecb",
  "des-ede3-cbc",
];

for (const cipher of ciphersToTest) {
  test(`generateKeyPairSync with PKCS8 cipher ${cipher}`, async () => {
    const code = `
      const crypto = require('crypto');
      const { privateKey, publicKey } = crypto.generateKeyPairSync('rsa', {
        modulusLength: 2048,
        publicKeyEncoding: { type: 'spki', format: 'pem' },
        privateKeyEncoding: { type: 'pkcs8', format: 'pem', cipher: '${cipher}', passphrase: 'test123' }
      });
      const message = 'hello world';
      const encrypted = crypto.privateEncrypt(
        { key: privateKey, passphrase: 'test123' },
        Buffer.from(message)
      );
      const decrypted = crypto.publicDecrypt(publicKey, encrypted).toString();
      console.log(decrypted);
    `;

    await using proc = Bun.spawn({
      cmd: [bunExe(), "-e", code],
      env: bunEnv,
      stdout: "pipe",
      stderr: "inherit",
    });

    const [stdout, exitCode] = await Promise.all([proc.stdout.text(), proc.exited]);

    expect(stdout.trim()).toBe("hello world");
    expect(exitCode).toBe(0);
  });
}
