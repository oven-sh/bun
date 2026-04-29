import { expect, test } from "bun:test";
import crypto from "crypto";

test("#24197 getCipherInfo: aes-128/192/256-ccm", () => {
  const cases: { name: "aes-128-ccm" | "aes-192-ccm" | "aes-256-ccm"; keyLength: number }[] = [
    { name: "aes-128-ccm", keyLength: 16 },
    { name: "aes-192-ccm", keyLength: 24 },
    { name: "aes-256-ccm", keyLength: 32 },
  ];
  for (const { name, keyLength } of cases) {
    const info = crypto.getCipherInfo(name);
    expect(info, `getCipherInfo(${name})`).toBeDefined();
    expect(info!.mode).toBe("ccm");
    expect(info!.keyLength).toBe(keyLength);
    expect(info!.blockSize).toBe(1);
  }
});

test("#24197 aes-128-ccm encrypt/decrypt round-trip", () => {
  const key = crypto.randomBytes(16);
  const iv = crypto.randomBytes(12);
  const authTagLength = 16;
  const plaintext = "matter-style payload";

  const cipher = crypto.createCipheriv("aes-128-ccm", key, iv, { authTagLength });
  const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final(), cipher.getAuthTag()]);

  const decipher = crypto.createDecipheriv("aes-128-ccm", key, iv, { authTagLength });
  decipher.setAuthTag(ciphertext.subarray(-authTagLength));
  const decrypted = Buffer.concat([decipher.update(ciphertext.subarray(0, -authTagLength)), decipher.final()]);

  expect(decrypted.toString("utf8")).toBe(plaintext);
});

test("#24197 aes-192-ccm and aes-256-ccm round-trip", () => {
  for (const bits of [192, 256] as const) {
    const name = `aes-${bits}-ccm` as const;
    const key = crypto.randomBytes(bits / 8);
    const iv = crypto.randomBytes(12);
    const authTagLength = 16;
    const plaintext = Buffer.from(`pt-${bits}`);

    const cipher = crypto.createCipheriv(name, key, iv, { authTagLength });
    const out = Buffer.concat([cipher.update(plaintext), cipher.final(), cipher.getAuthTag()]);

    const decipher = crypto.createDecipheriv(name, key, iv, { authTagLength });
    decipher.setAuthTag(out.subarray(-authTagLength));
    const decrypted = Buffer.concat([decipher.update(out.subarray(0, -authTagLength)), decipher.final()]);

    expect(decrypted.equals(plaintext), `${name} round-trip`).toBe(true);
  }
});

test("#28067 aes-256-ccm createCipheriv round-trip (parity with Node)", () => {
  const key = crypto.randomBytes(32);
  const iv = crypto.randomBytes(12);
  const authTagLength = 16;
  const plaintext = "hello";

  const cipher = crypto.createCipheriv("aes-256-ccm", key, iv, { authTagLength });
  const encrypted = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final(), cipher.getAuthTag()]);

  const decipher = crypto.createDecipheriv("aes-256-ccm", key, iv, { authTagLength });
  decipher.setAuthTag(encrypted.subarray(-authTagLength));
  const decrypted = Buffer.concat([decipher.update(encrypted.subarray(0, -authTagLength)), decipher.final()]);

  expect(decrypted.toString("utf8")).toBe(plaintext);
});

test("#24197 aes-128-ccm setAAD with plaintextLength", () => {
  const key = crypto.randomBytes(16);
  const iv = crypto.randomBytes(12);
  const authTagLength = 16;
  const aad = Buffer.from("associated");
  const data = Buffer.from("payload bytes");

  const cipher = crypto.createCipheriv("aes-128-ccm", key, iv, { authTagLength });
  cipher.setAAD(aad, { plaintextLength: data.length });
  const encrypted = Buffer.concat([cipher.update(data), cipher.final(), cipher.getAuthTag()]);

  const plaintextLength = encrypted.length - authTagLength;
  const decipher = crypto.createDecipheriv("aes-128-ccm", key, iv, { authTagLength });
  decipher.setAAD(aad, { plaintextLength });
  decipher.setAuthTag(encrypted.subarray(plaintextLength));
  const decrypted = Buffer.concat([decipher.update(encrypted.subarray(0, plaintextLength)), decipher.final()]);

  expect(decrypted.equals(data)).toBe(true);
});

test("#24197 getCiphers includes aes-128-ccm, aes-192-ccm, aes-256-ccm", () => {
  const names = crypto.getCiphers();
  expect(names).toContain("aes-128-ccm");
  expect(names).toContain("aes-192-ccm");
  expect(names).toContain("aes-256-ccm");
});
